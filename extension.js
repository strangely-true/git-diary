const vscode = require("vscode");
const axios = require("axios");
const path = require("path");
const { debounce } = require("lodash");

// Global variables
let commitInterval = null;
const DEFAULT_INTERVAL = 30; // minutes
const REPO_NAME = "github-diary-entries";
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
  try {
    const session = await vscode.authentication.getSession("github", ["repo"], {
      createIfNone: true,
    });
    await context.secrets.store("githubAccessToken", session.accessToken);
    return session.accessToken;
  } catch (error) {
    vscode.window.showErrorMessage("GitHub authentication failed");
    throw error;
  }
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
    .getConfiguration("githubDiary")
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
  const config = vscode.workspace.getConfiguration("githubDiary");
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
  if (shouldIgnorePath(document.uri.fsPath)) return null;
  if (trackedDocuments.has(document)) return null;

  const debouncedChanges = debounce(async () => {
    const filePath = document.uri.fsPath;
    const currentContent = document.getText();
    const previousContent = trackedDocuments.get(document) || "";

    if (currentContent === previousContent) return;

    const changes = [];
    const currentLines = currentContent.split("\n");
    const previousLines = previousContent.split("\n");

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

function createStatusBarItem(context) {
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );

  statusBarItem.text = "$(git-commit) Github Diary";
  statusBarItem.tooltip = "Click to configure diary settings";
  statusBarItem.command = "github-diary.showSettings";
  statusBarItem.show();

  // Register the command properly
  const settingsCommand = vscode.commands.registerCommand(
    "github-diary.showSettings",
    handleSettingsCommand(context) // Directly pass the returned function
  );

  context.subscriptions.push(statusBarItem, settingsCommand);

  return statusBarItem;
}

function handleSettingsCommand(context) {
  return async () => {
    const choice = await vscode.window.showQuickPick([
      "🕒 Change Commit Interval",
      "📝 Set Message Format",
      "🚫 Manage Ignored Paths",
      "⚙️ Open Full Settings"
    ]);

    if (!choice) return;

    try {
      switch (choice) {
        case "🕒 Change Commit Interval":
          await handleIntervalChange(context);
          break;
        
        case "📝 Set Message Format":
          await handleMessageFormatChange();
          break;
        
        case "🚫 Manage Ignored Paths":
          await handleIgnoredPaths();
          break;
        
        case "⚙️ Open Full Settings":
          await vscode.commands.executeCommand('workbench.action.openSettings', 'githubDiary');
          break;
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Settings update failed: ${error.message}`);
    }
  };
}

async function handleIntervalChange(context) {
  const current = context.globalState.get("commitInterval", DEFAULT_INTERVAL);
  const interval = await vscode.window.showInputBox({
    prompt: "Commit interval (minutes)",
    value: current.toString(),
    validateInput: value => 
      isNaN(value) || value < 1 ? "Must be a number ≥ 1" : null
  });

  if (interval) {
    const minutes = Math.max(1, parseInt(interval));
    context.globalState.update("commitInterval", minutes);
    setupCommitInterval(context, minutes * 60000);
    vscode.window.showInformationMessage(`Commit interval set to ${minutes} minutes`);
  }
}

async function handleMessageFormatChange() {
  const config = vscode.workspace.getConfiguration("githubDiary");
  const current = config.get("commitMessage", `Diary update: \${date}`);
  
  const message = await vscode.window.showInputBox({
    prompt: "Enter message format (use ${date} for timestamp)",
    value: current
  });

  if (message) {
    await config.update("commitMessage", message, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage("Commit message format updated");
  }
}

async function handleIgnoredPaths() {
  const config = vscode.workspace.getConfiguration("githubDiary");
  const current = config.get("ignoredPaths", []).join(', ');
  
  const paths = await vscode.window.showInputBox({
    prompt: "Comma-separated list of paths/patterns to ignore",
    value: current
  });

  if (paths) {
    const cleanedPaths = paths.split(',')
      .map(p => p.trim())
      .filter(p => p.length > 0);
    
    await config.update("ignoredPaths", cleanedPaths, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`Ignored paths updated (${cleanedPaths.length} patterns)`);
  }
}

async function setupCommitInterval(context, intervalMs) {
  if (commitInterval) clearInterval(commitInterval);

  try {
    const token = await authenticate(context);
    const username = await getGitHubUsername(token);
    await createGitHubRepo(token);

    commitInterval = setInterval(() => logActivity(token, username), intervalMs);
    
    context.subscriptions.push({
      dispose: () => {
        clearInterval(commitInterval);
        commitInterval = null;
      }
    });
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to initialize diary: ${error.message}`);
  }
}

function activate(context) {
  extensionContext = context;
  const tracker = trackAllChanges();

  context.subscriptions.push(
    ...vscode.workspace.textDocuments
      .map((doc) => trackDocumentChanges(doc))
      .filter(Boolean), // Remove null/undefined
    vscode.workspace.onDidOpenTextDocument((doc) => trackDocumentChanges(doc)),
    vscode.workspace.onDidCreateFiles((e) => tracker.trackFileOperations(e, "Created")),
    vscode.workspace.onDidDeleteFiles((e) => tracker.trackFileOperations(e, "Deleted")),
    vscode.workspace.onDidRenameFiles((e) => tracker.trackFileRename(e)), // Proper binding
    createStatusBarItem(context) // Initialize the status bar item
  );

  authenticate(context).then(() => {
    setupCommitInterval(
      context,
      context.globalState.get("commitInterval", DEFAULT_INTERVAL) * 60000
    );
  });
}

async function deactivate() {
  trackedDocuments.clear();
  if (commitInterval) clearInterval(commitInterval);
  try {
    const token = await extensionContext.secrets.get("githubAccessToken");
    await logActivity(token, await getGitHubUsername(token));
  } catch (error) {
    console.error("Final commit failed:", error);
  }
}

module.exports = { activate, deactivate };