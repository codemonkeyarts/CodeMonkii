/**
 * electron/main.js — desktop shell for CodeMonkii.
 *
 * Turns the loopback web app into a native desktop application (the way the
 * ComfyUI desktop app wraps its local Python server). On launch it:
 *
 *   1. makes sure Ollama is running (starts `ollama serve` if not),
 *   2. forks server.js on a free port using Electron's bundled Node,
 *   3. waits for the HTTP server to answer, then
 *   4. loads it in a BrowserWindow, showing a themed splash while it boots.
 *
 * The Express server is used completely unmodified — `npm start` still runs it
 * headless. Everything desktop-specific lives in this folder.
 */
const { app, BrowserWindow, Menu, shell, dialog, ipcMain } = require('electron');
const { fork, spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const net = require('net');

const APP_ROOT = path.join(__dirname, '..');
const SERVER = path.join(APP_ROOT, 'server.js');
const IS_WINDOWS = process.platform === 'win32';

const PREFERRED_PORT = Number(process.env.PORT) || 8113;

let serverProc = null;   // forked server.js
let ollamaProc = null;   // `ollama serve` we started (if any)
let win = null;
let serverPort = PREFERRED_PORT;

/** URLs the window itself is allowed to display: the app and its splash. */
function isAppUrl(url) {
  return url.startsWith(`http://127.0.0.1:${serverPort}/`)
    || url.startsWith(`http://localhost:${serverPort}/`)
    || url.startsWith('file://');
}

/* ----------------------------------------------------------------- settings */

/* Small persistent settings file in Electron's per-user data dir
 * (e.g. %APPDATA%\CodeMonkii\settings.json). Keys:
 *   modelsDir — 'default' to let Ollama use its own location (~/.ollama/models),
 *               or an absolute path the user picked on first launch;
 *   dataDir   — where projects & chats are stored (absent = default);
 *   skillsDir — where skills are scanned from (absent = default). */
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try { return JSON.parse(fs.readFileSync(settingsPath(), 'utf8')); }
  catch { return {}; }
}

function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  try { fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2)); } catch {}
  return next;
}

/**
 * Decide where Ollama should keep its models, in priority order:
 *   1. OLLAMA_MODELS already in the environment — respect it, never ask;
 *   2. a choice saved from a previous launch;
 *   3. ask the user (first launch only): Ollama default vs. pick a folder.
 * Returns an absolute path, or null meaning "leave it to Ollama's default".
 */
async function resolveModelsDir() {
  if (process.env.OLLAMA_MODELS) return process.env.OLLAMA_MODELS;

  const saved = loadSettings().modelsDir;
  if (saved === 'default') return null;
  if (saved && fs.existsSync(saved)) return saved;

  const { response } = await dialog.showMessageBox(win, {
    type: 'question',
    title: 'CodeMonkii — Ollama models',
    message: 'Where should Ollama store its models?',
    detail: 'Use the Ollama default (~/.ollama/models), or pick a folder — e.g. if your models live on another drive. You can change this later from the CodeMonkii menu.',
    buttons: ['Use Ollama default', 'Choose folder…'],
    defaultId: 0,
    cancelId: 0,
  });

  if (response === 1) {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Select your Ollama models folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (!canceled && filePaths[0]) {
      saveSettings({ modelsDir: filePaths[0] });
      return filePaths[0];
    }
  }
  saveSettings({ modelsDir: 'default' });
  return null;
}

/* --------------------------------------------------- preferences IPC (UI) */

/* What the in-app Preferences panel sees. For each location: the effective
 * path, whether it came from a user pick, and the env var that (when set)
 * always wins over the saved setting — shown read-only in the UI. */
function prefsSummary() {
  const s = loadSettings();
  const eff = effectiveStorage();
  return {
    modelsDir: s.modelsDir || null,
    envOverride: process.env.OLLAMA_MODELS || null,
    dataDir: eff.dataDir,
    dataDirCustom: Boolean(s.dataDir),
    dataDirEnv: process.env.CODEMONKII_DATA_DIR || null,
    skillsDir: eff.skillsDir,
    skillsDirCustom: Boolean(s.skillsDir),
    skillsDirEnv: process.env.CODEMONKII_SKILLS_DIR || null,
  };
}

async function pickFolder(title) {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title,
    properties: ['openDirectory', 'createDirectory'],
  });
  return canceled || !filePaths[0] ? null : filePaths[0];
}

/* Register a prefs IPC handler that only accepts calls from our own UI —
 * if the renderer were ever tricked into showing foreign content, that page
 * must not be able to reach the folder pickers or settings. */
function handleUI(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isAppUrl(event.senderFrame?.url || '')) throw new Error('unauthorized sender');
    return fn(...args);
  });
}

handleUI('prefs:get', () => prefsSummary());

handleUI('prefs:choose-models-dir', async () => {
  const p = await pickFolder('Select your Ollama models folder');
  if (!p) return null;
  saveSettings({ modelsDir: p });
  return prefsSummary();
});

handleUI('prefs:set-models-default', () => {
  saveSettings({ modelsDir: 'default' });
  return prefsSummary();
});

/* Data & skills folders: the server reads these at boot, so changing one
 * restarts the forked server and reloads the UI. */
handleUI('prefs:choose-data-dir', async () => {
  const p = await pickFolder('Select the folder for projects & chats');
  if (!p) return null;
  saveSettings({ dataDir: p });
  await restartServer();
  return prefsSummary();
});

handleUI('prefs:reset-data-dir', async () => {
  saveSettings({ dataDir: undefined });
  await restartServer();
  return prefsSummary();
});

handleUI('prefs:choose-skills-dir', async () => {
  const p = await pickFolder('Select your skills folder');
  if (!p) return null;
  saveSettings({ skillsDir: p });
  await restartServer();
  return prefsSummary();
});

handleUI('prefs:reset-skills-dir', async () => {
  saveSettings({ skillsDir: undefined });
  await restartServer();
  return prefsSummary();
});

/* ------------------------------------------------------------------ helpers */

/** Resolve to the first free TCP port at/after `start` on loopback. */
function findFreePort(start) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(findFreePort(start + 1)));
    srv.once('listening', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.listen(start, '127.0.0.1');
  });
}

/** Poll the app URL until it answers (or we give up). */
function waitForServer(port, timeoutMs = 30000) {
  const url = `http://127.0.0.1:${port}/`;
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - started > timeoutMs) reject(new Error('server did not start in time'));
        else setTimeout(tick, 300);
      });
    };
    tick();
  });
}

/** True if an `ollama` process appears to be running (best-effort, Windows). */
function ollamaRunning() {
  return new Promise((resolve) => {
    if (!IS_WINDOWS) return resolve(false);
    execFile('tasklist', ['/FI', 'IMAGENAME eq ollama.exe'], (err, stdout) => {
      resolve(!err && /ollama\.exe/i.test(stdout));
    });
  });
}

/** Start `ollama serve` if it isn't already running. Never throws.
 *  Only when WE have to start it does the models-dir question matter — if
 *  Ollama is already up it's using its own config, so we don't prompt. */
async function ensureOllama() {
  try {
    if (await ollamaRunning()) return;

    const modelsDir = await resolveModelsDir(); // null = Ollama's own default
    const env = { ...process.env };
    if (modelsDir) env.OLLAMA_MODELS = modelsDir;

    ollamaProc = spawn('ollama', ['serve'], {
      env,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    ollamaProc.on('error', () => { ollamaProc = null; }); // ollama not on PATH — ignore
    ollamaProc.unref();
  } catch { /* non-fatal: the app still runs, just without a local model server */ }
}

/**
 * Storage locations for project data and skills, in priority order:
 *   1. CODEMONKII_DATA_DIR / CODEMONKII_SKILLS_DIR env vars — always win;
 *   2. folders picked in the in-app Preferences panel (settings.json);
 *   3. defaults — %APPDATA%\CodeMonkii when installed (the install folder is
 *      replaced wholesale on every update, so user data can't live there),
 *      repo-local in dev, same as `npm start`.
 * Bundled sample skills are seeded into a fresh skills folder (never
 * overwriting existing files).
 */
function defaultStorage() {
  const base = app.isPackaged ? app.getPath('userData') : APP_ROOT;
  return {
    dataDir: path.join(base, 'data', 'projects'),
    skillsDir: path.join(base, 'skills'),
  };
}

function effectiveStorage() {
  const s = loadSettings();
  const d = defaultStorage();
  return {
    dataDir: process.env.CODEMONKII_DATA_DIR || s.dataDir || d.dataDir,
    skillsDir: process.env.CODEMONKII_SKILLS_DIR || s.skillsDir || d.skillsDir,
  };
}

function storageEnv() {
  const { dataDir, skillsDir } = effectiveStorage();
  if (app.isPackaged && !fs.existsSync(skillsDir)) {
    try {
      fs.cpSync(path.join(APP_ROOT, 'skills'), skillsDir, {
        recursive: true, force: false, errorOnExist: false,
      });
    } catch { try { fs.mkdirSync(skillsDir, { recursive: true }); } catch {} }
  }
  return { CODEMONKII_DATA_DIR: dataDir, CODEMONKII_SKILLS_DIR: skillsDir };
}

/** Kill the forked server, start it again with fresh env, reload the UI.
 *  Used when a storage preference changes — the server reads its config once
 *  at boot, so a directory change needs a clean restart to take effect. */
async function restartServer() {
  await new Promise((resolve) => {
    if (!serverProc) return resolve();
    serverProc.expectedExit = true;
    serverProc.once('exit', resolve);
    serverProc.kill();
  });
  startServer(serverPort);
  await waitForServer(serverPort);
  win?.webContents.reload();
}

/** Fork server.js using Electron's own Node runtime (ELECTRON_RUN_AS_NODE). */
function startServer(port) {
  serverProc = fork(SERVER, [], {
    cwd: APP_ROOT,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      PORT: String(port),
      ...storageEnv(),
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  serverProc.stdout?.on('data', (d) => process.stdout.write(`[server] ${d}`));
  serverProc.stderr?.on('data', (d) => process.stderr.write(`[server] ${d}`));
  serverProc.on('exit', function (code) {
    if (serverProc === this) serverProc = null;
    if (code && !app.isQuitting && !this.expectedExit) {
      dialog.showErrorBox('CodeMonkii', `The server process exited unexpectedly (code ${code}).`);
      app.quit();
    }
  });
}

/* ------------------------------------------------------------------- window */

function buildMenu() {
  const template = [
    {
      label: 'CodeMonkii',
      submenu: [
        {
          label: 'Open in Browser',
          click: () => shell.openExternal(`http://localhost:${serverPort}`),
        },
        { type: 'separator' },
        {
          label: 'Ollama Models Folder…',
          click: async () => {
            const { response } = await dialog.showMessageBox(win, {
              type: 'question',
              title: 'Ollama models folder',
              message: 'Where should Ollama store its models?',
              detail: 'Takes effect the next time CodeMonkii starts Ollama (quit Ollama and relaunch the app).',
              buttons: ['Use Ollama default', 'Choose folder…', 'Cancel'],
              defaultId: 0,
              cancelId: 2,
            });
            if (response === 0) saveSettings({ modelsDir: 'default' });
            if (response === 1) {
              const { canceled, filePaths } = await dialog.showOpenDialog(win, {
                title: 'Select your Ollama models folder',
                properties: ['openDirectory', 'createDirectory'],
              });
              if (!canceled && filePaths[0]) saveSettings({ modelsDir: filePaths[0] });
            }
          },
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'editMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0d0b14',
    show: false,
    title: 'CodeMonkii',
    icon: IS_WINDOWS ? path.join(__dirname, 'build', 'icon.ico') : undefined,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // Splash while the server boots.
  win.loadFile(path.join(__dirname, 'loading.html'));
  win.once('ready-to-show', () => win.show());

  // Open external links (docs, ollama.com, etc.) in the real browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!isAppUrl(url)) {
      if (/^https?:/i.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // The window itself may only ever show the app (or its splash) — anything
  // that would navigate it elsewhere opens in the real browser instead. This
  // also keeps the preload IPC bridge out of reach of any foreign page.
  win.webContents.on('will-navigate', (e, url) => {
    if (!isAppUrl(url)) {
      e.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });

  // A loopback chat UI has no business using camera/mic/location/etc.
  win.webContents.session.setPermissionRequestHandler((wc, permission, cb) => cb(false));

  win.on('closed', () => { win = null; });
}

/* --------------------------------------------------------------- lifecycle */

async function boot() {
  buildMenu();
  createWindow();

  serverPort = await findFreePort(PREFERRED_PORT);
  await ensureOllama();
  startServer(serverPort);

  try {
    await waitForServer(serverPort);
    if (win) await win.loadURL(`http://127.0.0.1:${serverPort}/`);
  } catch (e) {
    dialog.showErrorBox('CodeMonkii', `Could not reach the app server.\n\n${e.message}`);
    app.quit();
  }
}

// Single-instance: focus the existing window instead of launching a second copy.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });

  app.whenReady().then(boot);

  app.on('activate', () => {
    // reopen just the window — the server (if still up) keeps running
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      if (serverProc) win.loadURL(`http://127.0.0.1:${serverPort}/`);
      else boot();
    }
  });

  app.on('window-all-closed', () => app.quit());

  app.on('before-quit', () => { app.isQuitting = true; });

  app.on('quit', () => {
    try { serverProc?.kill(); } catch {}
    // Ollama we started is left running deliberately: models stay warm and
    // other local tools may be using it (same behavior as the .cmd launcher).
  });
}
