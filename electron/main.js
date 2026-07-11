/**
 * main.js — desktop shell entry point: window + app lifecycle.
 *
 * Turns the loopback web app into a native desktop application (the way the
 * ComfyUI desktop app wraps its local Python server). On launch it:
 *
 *   1. makes sure Ollama is running (starts `ollama serve` if not),
 *   2. forks server.js on a free port using Electron's bundled Node,
 *   3. waits for the HTTP server to answer, then
 *   4. loads it in a BrowserWindow, showing a themed splash while it boots.
 *
 * The Express server is used completely unmodified — `npm start` still runs
 * it headless. Everything desktop-specific lives in this folder, one module
 * per concern:
 *
 *   runtime.js    shared state (window, server process, port)
 *   settings.js   settings.json + storage-location resolution
 *   dialogs.js    native-dialog helpers
 *   ollama.js     starting Ollama + the models-folder question
 *   server.js     fork/wait/restart of the Express server
 *   menu.js       app menu with live Projects & Skills submenus
 *   prefs-ipc.js  Preferences IPC (validated senders)
 *   preload.js    contextBridge exposed to the web UI
 */
const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const runtime = require('./runtime');
const { ensureOllama } = require('./ollama');
const { findFreePort, waitForServer, startServer } = require('./server');
const { buildMenu } = require('./menu');
const { registerPrefsIpc } = require('./prefs-ipc');

/**
 * One-time data migration for the CodeMonkii → Monkii rebrand. The productName
 * change moves per-user storage from %APPDATA%\CodeMonkii to %APPDATA%\Monkii,
 * so on the first Monkii launch — if the new folder has no data yet and the
 * old install's folder exists — copy the projects, skills, settings, and logs
 * over so nothing is orphaned. Runs before anything reads the storage paths.
 */
function migrateLegacyData() {
  if (!app.isPackaged) return; // dev keeps its data repo-local
  try {
    const oldDir = path.join(app.getPath('appData'), 'CodeMonkii');
    const newDir = app.getPath('userData'); // %APPDATA%\Monkii
    const alreadyMigrated = fs.existsSync(path.join(newDir, 'data')) || fs.existsSync(path.join(newDir, 'settings.json'));
    if (!fs.existsSync(oldDir) || alreadyMigrated) return;
    for (const item of ['data', 'skills', 'settings.json', 'logs']) {
      const src = path.join(oldDir, item);
      if (fs.existsSync(src)) fs.cpSync(src, path.join(newDir, item), { recursive: true });
    }
  } catch { /* best-effort: a failed migration just starts fresh, no data lost */ }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0d0b14',
    show: false,
    title: 'Monkii',
    icon: runtime.IS_WINDOWS ? path.join(__dirname, 'build', 'icon.ico') : undefined,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  runtime.win = win;

  // Splash while the server boots.
  win.loadFile(path.join(__dirname, 'loading.html'));
  win.once('ready-to-show', () => win.show());

  // Open external links (docs, ollama.com, etc.) in the real browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!runtime.isAppUrl(url)) {
      if (/^https?:/i.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // The window itself may only ever show the app (or its splash) — anything
  // that would navigate it elsewhere opens in the real browser instead. This
  // also keeps the preload IPC bridge out of reach of any foreign page.
  win.webContents.on('will-navigate', (e, url) => {
    if (!runtime.isAppUrl(url)) {
      e.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });

  // A loopback chat UI has no business using camera/mic/location/etc.
  win.webContents.session.setPermissionRequestHandler((wc, permission, cb) => cb(false));

  // Native cut/copy/paste menu for text fields — Electron ships none by
  // default. Non-editable targets are handled by the web UI's own menus.
  win.webContents.on('context-menu', (e, params) => {
    if (!params.isEditable) return;
    Menu.buildFromTemplate([
      { role: 'undo' }, { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
      { type: 'separator' },
      { role: 'selectAll' },
    ]).popup({ window: win });
  });

  // Keep the menu's Projects/Skills submenus in sync with app data.
  win.on('focus', () => { buildMenu(); });

  win.on('closed', () => { runtime.win = null; });
}

async function boot() {
  migrateLegacyData(); // carry data over from a prior CodeMonkii install
  buildMenu();
  createWindow();

  runtime.serverPort = await findFreePort(runtime.PREFERRED_PORT);
  await ensureOllama();
  startServer(runtime.serverPort);

  try {
    await waitForServer(runtime.serverPort);
    if (runtime.win) await runtime.win.loadURL(runtime.appUrl());
    buildMenu(); // now with live projects & skills
  } catch (e) {
    dialog.showErrorBox('Monkii', `Could not reach the app server.\n\n${e.message}`);
    app.quit();
  }
}

// Single-instance: focus the existing window instead of launching a second copy.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  registerPrefsIpc();

  app.on('second-instance', () => {
    const { win } = runtime;
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });

  app.whenReady().then(boot);

  app.on('activate', () => {
    // reopen just the window — the server (if still up) keeps running
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      if (runtime.serverProc) runtime.win.loadURL(runtime.appUrl());
      else boot();
    }
  });

  app.on('window-all-closed', () => app.quit());

  app.on('before-quit', () => { app.isQuitting = true; });

  app.on('quit', () => {
    try { runtime.serverProc?.kill(); } catch {}
    // Ollama we started is left running deliberately: models stay warm and
    // other local tools may be using it (same behavior as the .cmd launcher).
  });
}
