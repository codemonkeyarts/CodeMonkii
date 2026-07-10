# 🐒 CodeMonkii

A local, private LLM studio for [Ollama](https://ollama.com) — projects, Claude-style skills, and live file knowledge. Nothing ever leaves your machine.

## Quick start

```powershell
git clone https://github.com/codalanguez/CodeMonkii.git
cd CodeMonkii
npm install        # first time only
npm start          # then open http://localhost:8113
```

On Windows you can also just double-click **`Start CodeMonkii.cmd`** — it starts Ollama if needed and opens the app.

Requires **Node.js 18+** and **Ollama** running locally (`ollama serve`, or the Ollama app) with at least one model pulled, e.g. `ollama pull llama3.2`.

## Desktop app

CodeMonkii can also run as a native desktop application (like the ComfyUI desktop app) instead of in a browser tab. An [Electron](https://www.electronjs.org) shell starts Ollama, boots the server on a free port, and shows the UI in its own window with a splash screen.

```powershell
npm install        # first time only — pulls in Electron
npm run desktop    # launches the desktop app
```

Or double-click **`Start CodeMonkii Desktop.cmd`** (installs dependencies on first run).

**Preferences** — the ⚙ gear in the sidebar footer opens a panel with three storage locations, each user-changeable via a native folder picker (or resettable to its default):

- **Ollama models folder** — where pulled models live. If the app has to start Ollama itself, it asks once on first launch (Ollama default `~/.ollama/models`, or pick a folder). Applies the next time CodeMonkii starts Ollama; also reachable via the **CodeMonkii → Ollama Models Folder…** menu. If Ollama is already running, it uses whatever Ollama is configured with.
- **Projects & chats folder** — where conversations and project settings are saved. Changing it restarts the server and reloads the UI; existing chats stay in the old folder (move the JSON files manually if you want them along).
- **Skills folder** — where `SKILL.md` folders are scanned from. Point it at `~\.claude\skills` to use your Claude Code skills as-is.

Each location's env var (`OLLAMA_MODELS`, `CODEMONKII_DATA_DIR`, `CODEMONKII_SKILLS_DIR`) always wins over the saved preference and shows as read-only in the panel.

### Build a standalone installer

To produce a Windows installer (`.exe`) you can hand to another machine — no Node required on the target:

```powershell
npm run dist       # outputs CodeMonkii Setup <version>.exe under dist/
```

The installer is a standard NSIS setup: install-location picker, Start-menu entry, desktop shortcut, uninstaller. It installs per-user (no admin needed). The target machine only needs [Ollama](https://ollama.com/download).

When running as an installed app, project data and skills live in `%APPDATA%\CodeMonkii` (`data\projects` and `skills`), so updates and uninstalls never touch your chats; the bundled sample skills are copied there on first run. A repo checkout (`npm start` / `npm run desktop`) keeps everything repo-local as before. `CODEMONKII_DATA_DIR` / `CODEMONKII_SKILLS_DIR` env vars override either way.

The build config lives in `package.json` under `"build"`; icon assets are in `electron/build/`. The desktop shell lives entirely in `electron/` and reuses the server unchanged — `npm start` still runs it headless in a browser.

**Code signing** — point electron-builder at a PFX and it signs the app, uninstaller, and installer (SHA-256 + RFC-3161 timestamp):

```powershell
$env:CSC_LINK = "$HOME\.codemonkii-signing\codemonkii-codesign.pfx"
$env:CSC_KEY_PASSWORD = Get-Content "$HOME\.codemonkii-signing\pfx-password.txt"
npm run dist
```

A self-signed certificate (as generated here) makes signatures verify on machines that trust it, but other people's PCs still see "unknown publisher" and SmartScreen still warns — only a CA-issued certificate (Azure Trusted Signing, or an OV cert from SSL.com/Certum, or SignPath's free open-source program) fixes that. Swap the PFX path when you get one; nothing else changes.

## Features

### Projects (like Claude Projects)
Each project bundles:
- **Instructions** — a system prompt applied to every chat in the project
- **Knowledge** — files and folders attached from your machine
- **Skills** — always-on skills for the project
- **Chats** — as many conversations as you like, each remembering its model

Everything is stored as plain JSON under `data/projects/` — easy to back up, easy to inspect, never leaves your disk.

### Skills (Claude skill format)
Drop a folder into `skills/`, containing a `SKILL.md` with YAML frontmatter:

```
skills/
  my-skill/
    SKILL.md
```

```markdown
---
name: my-skill
description: One line describing when to use this skill.
---

Instructions the model follows when the skill is loaded…
```

Or create one in-app: **✦ Skills → + New skill** scaffolds the folder and a starter `SKILL.md` from a built-in template (`lib/skill-template.md`) — then edit the file to write the instructions. Also available from the desktop menu (**CodeMonkii → Skills → New Skill…**).

Prefer not to write it yourself? **✦ Create with model** has one of your installed Ollama models draft the instructions from your name + description brief. The model picker recommends the best installed candidate for the job (solid instruct families at GPU-friendly sizes; reasoning and cloud models rank lower). Review the generated `SKILL.md` before relying on it.

Two ways to use a skill:
1. **Project toggle** — switch it on in the project panel; it loads into every message.
2. **Slash invoke** — type `/` in the composer and pick a skill; it loads for that message only (and stays in the conversation history from then on).

Existing Claude Code skills work as-is — point CodeMonkii at them:

```powershell
$env:CODEMONKII_SKILLS_DIR = "$HOME\.claude\skills"; npm start
```

### File & directory knowledge
Attach any file or folder via the built-in browser. Contents are **re-read from disk on every message**, so your latest edits are always what the model sees. Directories are walked recursively (skipping `node_modules`, `.git`, build output, binaries) with size budgets so you don't blow out the context window.

### Ollama
- Auto-detects Ollama at `http://localhost:11434` (override with `OLLAMA_HOST`; bind-style values like `0.0.0.0` are normalized automatically)
- Model picker per chat, streaming responses, stop button
- Health indicator in the sidebar
- Update check on startup (cached daily): when a newer Ollama release exists, the server logs it and the sidebar shows a download pill — disable with `CODEMONKII_UPDATE_CHECK=off`

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `PORT` | `8113` | Web UI port |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama server address |
| `CODEMONKII_SKILLS_DIR` | `./skills` | Where to scan for skills |
| `CODEMONKII_FS_ROOTS` | *(unset — whole disk)* | Semicolon-separated list of directories the file browser and attachments are restricted to, e.g. `C:\projects;D:\writing` |
| `CODEMONKII_UPDATE_CHECK` | `on` | Set to `off` to disable the daily Ollama update check |

## Security

CodeMonkii is a single-user local app, hardened accordingly:

- **Loopback only** — the server binds `127.0.0.1`; it is never reachable from the network.
- **DNS-rebinding protection** — requests with a `Host` header other than `localhost`/`127.0.0.1` are rejected, so a malicious website that points its own domain at your loopback address gets a 403.
- **CSRF protection** — cross-origin requests (any `Origin` other than the app's own) are rejected.
- **Content Security Policy** — scripts run from the app's own origin only; no eval, no inline scripts, no third-party script sources. Plus `nosniff`, `no-referrer`, and a locked-down `Permissions-Policy`.
- **Filesystem scoping** — set `CODEMONKII_FS_ROOTS` to fence browsing *and* attachment reads into specific directories; the check runs both when attaching and again on every read.
- **Input validation** — project/skill ids are strictly validated (no path traversal), all model output is HTML-escaped before rendering, and errors return generic JSON with no stack traces.

Your chats and project data stay on your disk. UI fonts are bundled locally (no Google Fonts requests), so the only outbound connections are to your local Ollama and one GitHub API call per day to check the latest Ollama release version (no data sent; `CODEMONKII_UPDATE_CHECK=off` disables it — then nothing leaves your machine at all).

The desktop shell adds its own hardening: sandboxed renderer with context isolation, a navigation guard (the window can only ever display the app — external links open in your real browser), all web permission requests (camera, mic, location…) denied, and preferences IPC that only accepts calls from the app's own pages.

## Layout

```
server.js               entry point: middleware, routers, listen
lib/
  config.js             env + constants (ports, paths, context budgets)
  security.js           Host/Origin validation, CSP, fs allowlist
  store.js              project JSON persistence
  skills.js             SKILL.md discovery + frontmatter parsing
  attachments.js        reading knowledge from disk under byte budgets
  prompt.js             system prompt assembly
  ollama.js             Ollama HTTP client + release update check
routes/
  projects.js           projects / chats / attachments CRUD
  skills.js             skill listing endpoints
  fs.js                 file-browser directory listings
  ollama.js             health, models, update check, streaming chat
public/
  index.html            single-page UI shell
  style.css             midnight-workshop theme
  js/                   ES modules, one per feature:
    main.js             wiring + startup
    state.js            shared client state
    api.js              JSON fetch client
    util.js             DOM helpers ($, esc, toast)
    markdown.js         safe markdown renderer
    status.js           health indicator, model list, update pill
    skills.js           skill catalog, toggles + "/" invocation
    skill-create.js     adding skills: template, model-written, import
    views.js            main-area view switching (welcome / projects / chat)
    modal.js            shared open/close behavior for backdrop modals
    ctxmenu.js          right-click menus (chats, projects, messages, skills)
    projects.js         projects page, lifecycle + inspector
    attachments.js      knowledge panel + file browser
    chat.js             messages, streaming, stop
    prefs.js            preferences panel (storage folders; desktop app only)
skills/                 your skills (3 samples included)
data/projects/          project + chat storage (JSON, gitignored)
electron/               desktop shell, one module per concern
  main.js               entry point: window + app lifecycle
  runtime.js            shared state (window, server process, port)
  settings.js           settings.json + storage-location resolution
  dialogs.js            native-dialog helpers
  ollama.js             starting Ollama + the models-folder question
  server.js             fork/wait/restart of the Express server
  menu.js               app menu with live Projects & Skills submenus
  prefs-ipc.js          preferences IPC (validated senders)
  preload.js            contextBridge exposed to the web UI
  loading.html          themed splash shown while the server boots
  build/                icon assets + installer resources
```

Each module carries a header comment explaining its responsibility.
