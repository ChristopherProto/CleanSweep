# CleanSweep

AI-powered folder cleanup — Organize your files intelligently with Gemini, Claude, or GPT.

## Features

- **AI-Powered Organization** — Uses Gemini, Claude, or GPT to analyze filenames, types, sizes, and dates to intelligently categorize files
- **Smart Folder Detection** — Reuses existing CleanUp subfolders when files match, creates new categories when needed
- **Three AI Providers** — Switch between Google Gemini (free tier), Anthropic Claude, or OpenAI GPT
- **Full Undo Support** — Every sweep is logged; undo any sweep to restore files to their original locations
- **Sweep History** — Detailed logs saved to CleanUp/CleanUpLog with timestamps, provider info, and file-by-file records
- **Preview Before Execute** — Scan → AI Analysis → Review Plan → Execute (3-step confirmation flow)
- **Custom Instructions** — Tell the AI how you want files grouped (e.g., "keep design files together")
- **Ignore Filters** — Skip files by extension (.tmp, .log, etc.)
- **Duplicate Handling** — Automatically renames files if a duplicate exists at the destination
- **Windows Installer** — Builds to a one-click NSIS installer via electron-builder

## How It Works

1. Select a folder (e.g., your Downloads folder)
2. Click **Scan** to read all files
3. Click **Analyze with AI** — the AI examines file names, types, sizes, and dates
4. Review the proposed organization plan
5. Click **Execute Sweep** to move files into `CleanUp/` subfolders
6. Use **History** tab to view logs or undo any sweep

## Setup

```bash
# Install dependencies
npm install

# Run in development
npm start

# Build Windows installer
npm run build
```

The installer will be created in the `dist/` folder.

## Settings

- **API Keys** are stored locally in your app data folder only
- Get keys from:
  - [Google AI Studio](https://makersuite.google.com/app/apikey) (Gemini)
  - [Anthropic Console](https://console.anthropic.com/) (Claude)
  - [OpenAI Platform](https://platform.openai.com/api-keys) (GPT)

## Architecture

Built with Electron following the same patterns as Eyeris:
- `main.js` — Electron main process (file system ops, IPC handlers)
- `preload.js` — Secure IPC bridge (contextIsolation: true)
- `index.html` — Complete UI in a single HTML file (HTML/CSS/JS)
- Frameless window with custom titlebar
- System tray integration
- Settings persisted to userData
