# Github Diary - Your Code Journal 🗓️

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/strangely-true.github-diary?color=blue&label=VS%20Code%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=strangely-true.github-diary)
[![GitHub License](https://img.shields.io/github/license/strangely-true/github-diary)](https://github.com/strangely-true/github-diary/blob/master/LICENSE)
[![Open Issues](https://img.shields.io/github/issues/strangely-true/github-diary)](https://github.com/strangely-true/github-diary/issues)

![Github Diary Banner](./images/banner.png)

Never lose track of your coding progress. Git Diary automatically records your development activity in a private GitHub repository, creating a detailed, timestamped journal of your work.

## Features ✨

### 📅 Automated Code Journaling
- **Smart Change Tracking**: Records code snippets with line numbers
- **Configurable Intervals**: Auto-commit every 30 mins (adjustable)
- **Private GitHub Repo**: Secure storage in `github-diary-entries` repository
- **File History**: Track file operations (create/rename/delete)

![Activity Tracking Demo](./images/demo.gif)

### ⚙️ Intelligent Configuration
- **Custom Ignore Patterns**: Built-in + user-defined path exclusion
- **Commit Templates**: Support for dynamic date/time variables
- **Status Bar Control**: Quick access to settings and stats

### 🔒 Security First
- GitHub OAuth authentication
- Token stored in VS Code secure storage
- Private repository ownership
- No third-party data collection

## Installation 🚀

1. Open VS Code Extensions (`Ctrl+Shift+X`)
2. Search for "Git Diary"
3. Click Install

**Or install manually:**
```bash
github clone https://github.com/strangely-true/github-diary.git
cd github-diary
npm install
vsce package
code --install-extension github-diary-0.1.0.vsix
```

## Setup Guide 🔧

1. Click the Git Diary status bar icon
2. Select "Authenticate with GitHub"
3. Grant repo access through GitHub OAuth
4. Private repository auto-created at:
   ```
   github.com/<your-username>/github-diary-entries
   ```

### Configuration ⚙️

Access settings via:
- Status bar icon
- Command Palette (`Ctrl+Shift+P`)
- VS Code settings UI

#### Key Settings:
```json
{
  "githubDiary.commitInterval": 30,
  "githubDiary.commitMessage": "Diary update: ${date}",
  "githubDiary.ignoredPaths": [
    "/node_modules/",
    "/dist/",
    "*.log",
    ".env"
  ]
}
```

#### Commands:
```bash
Git Diary: Open Settings          # Main configuration hub
Git Diary: Change Commit Interval # Set auto-commit frequency
Git Diary: Manage Ignored Paths   # Edit exclusion patterns
```

## Data Structure 📂

### Repository Organization:
```bash
📂 github-diary-entries
 └📂 2025
   └📂 01
     └📄 15.md  # Daily Markdown file
```

### Sample Entry:
```markdown
## 2024-01-15 14:30

### index.ts
*src/components*

- 14:32: Modified line 15:
  `const [state, setState] = useState(initial...`
  
- 14:45: Renamed from old-component.tsx
- 15:00: Created new-utils.ts
```

## Privacy & Security 🔐

- **Ownership**: You retain full control of repository
- **Access**: Requires only repo scope GitHub token
- **Storage**: All data remains in your GitHub account
- **Encryption**: Communications via HTTPS/TLS

## Troubleshooting 🛠️

### Common Solutions:

**Authentication Failed:**
- Re-authenticate via status bar menu
- Check GitHub token in VS Code secrets

**Missing Commits:**
- Verify repository exists at correct URL
- Check network connectivity

**Unexpected File Tracking:**
- Update `ignoredPaths` in settings
- Use regex patterns for complex exclusions



### Development Setup:
```bash
git clone https://github.com/strangely-true/github-diary.git
npm install
npm run compile
npm test
```

## License 📄

MIT License - See [LICENSE](https://github.com/strangely-true/github-diary/blob/master/LICENSE) for full text

---

✨ **Transform Your Workflow - Never lose a code change again!** ✨
