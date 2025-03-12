const vscode = require("vscode");
const axios = require("axios");
const path = require("path");
const { debounce } = require("lodash");

// Global variables
let commitInterval = null;
let statusBarItem = null;
const DEFAULT_INTERVAL = 30; // minutes
const REPO_NAME = "git-diary-entries";
let intervalChangeLog = {};
let extensionContext = null;

const ignoreFilepath = ["/node_modules/", /\.env$/, "/dist/", /\.log$/];

// Configuration
const config = {
  debounceTime: 1500, // 1.5 seconds to group typing events
  maxSnippetLength: 300,
};

/**
 * Core functionality
 */
async function authenticate(context) {
  const session = await vscode.authentication.getSession("github", ["repo"], {
    createIfNone: true,
  });
  await context.secrets.store("githubAccessToken", session.accessToken);
  return session.accessToken;
}

async function getGitHubUsername(token) {
  const response = await axios.get("https://api.github.com/user", {
    headers: { Authorization: `token ${token}` },
  });
  return response.data.login;
}

async function createGitHubRepo(token) {
  try {
    await axios.post(
      "https://api.github.com/user/repos",
      { name: REPO_NAME, private: true, auto_init: true },
      { headers: { Authorization: `token ${token}` } }
    );
  } catch (error) {
    if (error.response.status !== 422) throw error;
  }
}

async function updateDiaryEntry(token, username, content) {
  const date = new Date();
  const [dateString, timeString] = [
    date.toISOString().split("T")[0],
    date.toLocaleTimeString("en-US", { hour12: false }),
  ];

  const filePath = `${date.getFullYear()}/${String(
    date.getMonth() + 1
  ).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}.md`;
  const url = `https://api.github.com/repos/${username}/${REPO_NAME}/contents/${filePath}`;

  let sha,
    existingContent = "";
  try {
    const { data } = await axios.get(url, {
      headers: { Authorization: `token ${token}` },
    });
    sha = data.sha;
    existingContent = Buffer.from(data.content, "base64").toString();
  } catch (error) {
    if (error.response?.status !== 404) throw error;
  }

  const commitMessage = vscode.workspace
    .getConfiguration("gitDiary")
    .get("commitMessage", `Diary update: ${dateString} ${timeString}`);

  const entrySeparator = existingContent ? "\n\n" : "";
  const newContent = `${existingContent}${entrySeparator}## ${timeString}\n${content}`;

  await axios.put(
    url,
    {
      message: commitMessage,
      content: Buffer.from(newContent).toString("base64"),
      sha: sha || undefined,
    },
    { headers: { Authorization: `token ${token}` } }
  );
}

/**
 * Optimized Activity Tracking
 */
function shouldIgnorePath(filePath) {
  const config = vscode.workspace.getConfiguration("gitDiary");
  const ignoredPatterns = [
    ...ignoreFilepath, // Predefined patterns
    ...config.get("ignoredPaths", []), // User-configured patterns
  ];

  return ignoredPatterns.some((pattern) =>
    typeof pattern === "string"
      ? filePath.includes(pattern)
      : pattern.test(filePath)
  );
}

const trackedDocuments = new Map();

function trackDocumentChanges(document) {
  if (shouldIgnorePath(document.uri.fsPath) || trackedDocuments.has(document))
    return;

  const debouncedChanges = debounce(async () => {
    const filePath = document.uri.fsPath;
    const currentContent = document.getText();
    const previousContent = trackedDocuments.get(document) || "";

    if (currentContent === previousContent) return;

    const changes = [];
    const currentLines = currentContent.split("\n");
    const previousLines = previousContent.split("\n");

    // Compare line by line to find meaningful changes
    for (
      let i = 0;
      i < Math.max(currentLines.length, previousLines.length);
      i++
    ) {
      const currentLine = currentLines[i] || "";
      const previousLine = previousLines[i] || "";

      if (currentLine !== previousLine) {
        const snippet = currentLine.slice(0, config.maxSnippetLength);
        changes.push({
          type: "code_change",
          snippet:
            snippet +
            (currentLine.length > config.maxSnippetLength ? "..." : ""),
          lines: i + 1,
          timestamp: new Date(),
        });
      }
    }

    if (changes.length > 0) {
      intervalChangeLog[filePath] = [
        ...(intervalChangeLog[filePath] || []),
        ...changes,
      ];
    }

    trackedDocuments.set(document, currentContent);
  }, config.debounceTime);

  trackedDocuments.set(document, document.getText());
  return vscode.workspace.onDidChangeTextDocument((e) => {
    if (e.document === document) debouncedChanges();
  });
}

function trackAllChanges() {
  return {
    trackFileOperations(event, operation) {
      event.files.forEach((uri) => {
        const filePath = uri.fsPath;
        if (shouldIgnorePath(filePath)) return;

        intervalChangeLog[filePath] = [
          ...(intervalChangeLog[filePath] || []),
          {
            type: "file_operation",
            operation: operation,
            timestamp: new Date(),
          },
        ];
      });
    },

    trackFileRename(event) {
      event.files.forEach(({ oldUri, newUri }) => {
        const oldPath = oldUri.fsPath;
        const newPath = newUri.fsPath;

        if (!shouldIgnorePath(oldPath)) {
          intervalChangeLog[oldPath] = [
            ...(intervalChangeLog[oldPath] || []),
            {
              type: "file_operation",
              operation: `renamed to ${path.basename(newPath)}`,
              timestamp: new Date(),
            },
          ];
        }

        if (!shouldIgnorePath(newPath)) {
          intervalChangeLog[newPath] = [
            ...(intervalChangeLog[newPath] || []),
            {
              type: "file_operation",
              operation: `renamed from ${path.basename(oldPath)}`,
              timestamp: new Date(),
            },
          ];
        }
      });
    },
  };
}

function generateActivityContent() {
  if (Object.keys(intervalChangeLog).length === 0) return null;

  const now = new Date();
  let content = `## ${now.toLocaleDateString()} ${now.toLocaleTimeString()}\n\n`;

  Object.entries(intervalChangeLog).forEach(([filePath, changes]) => {
    const fileName = path.basename(filePath);
    const fileDir = path.relative(
      vscode.workspace.rootPath,
      path.dirname(filePath)
    );

    content += `### ${fileName}\n*${fileDir || "workspace root"}*\n`;

    changes.forEach((change) => {
      const time = change.timestamp.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });

      content += `- **${time}**: ${
        change.type === "code_change"
          ? `Modified line ${change.lines}:\n  \`${change.snippet}\``
          : change.operation
      }\n`;
    });

    content += "\n";
  });

  intervalChangeLog = {};
  return content;
}

/**
 * Optimized UI & Core Lifecycle
 */
async function logActivity(token, username) {
  const content = generateActivityContent();
  if (content) await updateDiaryEntry(token, username, content);
}

function createStatusBarItem() {
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.text = "$(git-commit) Git Diary";
  statusBarItem.tooltip = "Click to change commit interval";
  statusBarItem.command = "git-diary.changeInterval";
  statusBarItem.show();
  return statusBarItem;
}

async function setupCommitInterval(context, intervalMs) {
  if (commitInterval) clearInterval(commitInterval);

  const { token, username } = await (async () => {
    const token = await authenticate(context);
    return {
      token,
      username: await getGitHubUsername(token),
      repo: await createGitHubRepo(token),
    };
  })();

  commitInterval = setInterval(() => logActivity(token, username), intervalMs);
  context.subscriptions.push({ dispose: () => clearInterval(commitInterval) });
}

function activate(context) {
  extensionContext = context;
  const tracker = trackAllChanges();
  
  // Document tracking
  context.subscriptions.push(
    ...vscode.workspace.textDocuments.map((doc) => trackDocumentChanges(doc)),
    vscode.workspace.onDidOpenTextDocument((doc) => trackDocumentChanges(doc)),
    vscode.workspace.onDidChangeTextDocument(() => {}), // Handled by trackDocumentChanges
    vscode.workspace.onDidCreateFiles((e) =>
      tracker.trackFileOperations(e, "Created")
    ),
    vscode.workspace.onDidDeleteFiles((e) =>
      tracker.trackFileOperations(e, "Deleted")
    ),
    vscode.workspace.onDidRenameFiles(tracker.trackFileRename),
    createStatusBarItem(context),
    vscode.commands.registerCommand("git-diary.changeInterval", () => {
      vscode.window
        .showInputBox({
          prompt: "Commit interval (minutes)",
          value: context.globalState.get("commitInterval", DEFAULT_INTERVAL),
        })
        .then((interval) => {
          const minutes = Math.max(1, parseInt(interval) || DEFAULT_INTERVAL);
          context.globalState.update("commitInterval", minutes);
          setupCommitInterval(context, minutes * 60000);
        });
    })
  );

  setupCommitInterval(
    context,
    context.globalState.get("commitInterval", DEFAULT_INTERVAL) * 60000
  );
}

async function deactivate() {
  if (commitInterval) clearInterval(commitInterval);
  try {
    const token = await extensionContext.secrets.get("githubAccessToken");
    await logActivity(token, await getGitHubUsername(token));
  } catch (error) {
    console.error("Final commit failed:", error);
  }
}

module.exports = { activate, deactivate };
