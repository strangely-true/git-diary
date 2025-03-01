const vscode = require("vscode");
const axios = require("axios");
const path = require("path");

// Global variables
let commitInterval = null;
let statusBarItem = null;
const DEFAULT_INTERVAL = 30; // minutes
const REPO_NAME = "git-diary-entries";

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
    vscode.window.showErrorMessage("Authentication failed: " + error.message);
    throw error;
  }
}

async function getGitHubUsername(token) {
  try {
    const response = await axios.get("https://api.github.com/user", {
      headers: { Authorization: `token ${token}` },
    });
    return response.data.login;
  } catch (error) {
    vscode.window.showErrorMessage(
      "Failed to fetch GitHub user: " + error.message
    );
    throw error;
  }
}

async function createGitHubRepo(token) {
  try {
    await axios.post(
      "https://api.github.com/user/repos",
      {
        name: REPO_NAME,
        private: true,
        auto_init: true,
      },
      {
        headers: { Authorization: `token ${token}` },
      }
    );
  } catch (error) {
    if (error.response.status === 422) {
      return; // Repo already exists
    }
    vscode.window.showErrorMessage("Repo creation failed: " + error.message);
    throw error;
  }
}

async function updateDiaryEntry(token, username, content) {
  try {
    const date = new Date();
    const dateString = date.toISOString().split("T")[0];
    const timeString = date.toLocaleTimeString();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0"); // Months are 0-based
    const day = String(date.getDate()).padStart(2, "0");

    const filePath = `${year}/${month}/${day}.md`;

    // Get existing content
    const url = `https://api.github.com/repos/${username}/${REPO_NAME}/contents/${filePath}`;
    let sha = null;

    try {
      const response = await axios.get(url, {
        headers: { Authorization: `token ${token}` },
      });
      sha = response.data.sha;
    } catch (error) {
      if (error.response.status !== 404) throw error;
    }

    // Prepare new content
    const newContent = `## ${timeString}\n${content}\n\n`;
    let existingContent = "";
    if (sha) {
      const response = await axios.get(url, {
        headers: { Authorization: `token ${token}` },
      });
      existingContent = Buffer.from(response.data.content, "base64").toString();
    }
    const encodedContent = Buffer.from(existingContent + newContent).toString(
      "base64"
    );

    // Update file
    await axios.put(
      url,
      {
        message: `Diary update: ${dateString} ${timeString}`,
        content: encodedContent,
        sha: sha,
      },
      {
        headers: { Authorization: `token ${token}` },
      }
    );
  } catch (error) {
    vscode.window.showErrorMessage("Commit failed: " + error.message);
    throw error;
  }
}

/**
 * Activity tracking
 */
let changeLog = {}; // Store changes per file

function trackChanges(event) {
    const doc = event.document;
    const filePath = doc.uri.fsPath;
    
    event.contentChanges.forEach(change => {
        const { range, text } = change;
        const startLine = range.start.line + 1; // 1-based index
        
        if (!changeLog[filePath]) {
            changeLog[filePath] = [];
        }
        
        changeLog[filePath].push({
            time: new Date().toLocaleTimeString(),
            line: startLine,
            change: text.trim() ? `Added: "${text.trim()}"` : `Deleted`,
        });
    });
}



async function generateActivityContent() {
    if (Object.keys(changeLog).length === 0) return "No recent changes";

    let content = "";

    for (const [file, changes] of Object.entries(changeLog)) {
        content += `#### File: ${path.basename(file)}\n`;
        changes.forEach(({ time, line, change }) => {
            content += `- **${time}** (Line ${line}): ${change}\n`;
        });
        content += "\n";
    }

    changeLog = {}; // Clear logs after processing
    return content;
}


async function logActivity(context) {
  try {
    const token = await authenticate(context);
    const username = await getGitHubUsername(token);
    await createGitHubRepo(token);
    const content = await generateActivityContent();
    await updateDiaryEntry(token, username, content);
  } catch (error) {
    console.error("Activity logging error:", error);
  }
}

/**
 * UI Elements
 */
function createStatusBarItem(context) {
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.text = "$(git-commit) Git Diary";
  statusBarItem.tooltip = "Click to change commit interval";
  statusBarItem.command = "git-diary.changeInterval";
  statusBarItem.show();

  context.subscriptions.push(statusBarItem);
}

async function changeCommitInterval(context) {
  const interval = await vscode.window.showInputBox({
    prompt: "Enter commit interval in minutes",
    value: context.globalState
      .get("commitInterval", DEFAULT_INTERVAL)
      .toString(),
  });

  if (interval) {
    const minutes = Math.max(1, parseInt(interval)) || DEFAULT_INTERVAL;
    context.globalState.update("commitInterval", minutes);
    setupCommitInterval(context, minutes * 60 * 1000);
    vscode.window.showInformationMessage(
      `Commit interval set to ${minutes} minutes`
    );
  }
}

/**
 * Core lifecycle
 */
function setupCommitInterval(context, intervalMs) {
  if (commitInterval) clearInterval(commitInterval);

  commitInterval = setInterval(() => {
    logActivity(context);
  }, intervalMs);

  context.subscriptions.push({
    dispose: () => {
      if (commitInterval) clearInterval(commitInterval);
    },
  });
}

function activate(context) {
    vscode.workspace.onDidChangeTextDocument(trackChanges, null, context.subscriptions);
  // Initialize commit interval
  const initialInterval =
    context.globalState.get("commitInterval", DEFAULT_INTERVAL) * 60 * 1000;
  setupCommitInterval(context, initialInterval);

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand("git-diary.logActivity", () =>
      logActivity(context)
    ),
    vscode.commands.registerCommand("git-diary.changeInterval", () =>
      changeCommitInterval(context)
    )
  );

  // Create UI elements
  createStatusBarItem(context);

  console.log("Git Diary extension activated");
}

function deactivate(context) {
  logActivity(context);
  if (commitInterval) clearInterval(commitInterval);
}

module.exports = { activate, deactivate };
