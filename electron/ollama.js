/**
 * ollama.js — keeping the local Ollama server available.
 *
 * The shell starts `ollama serve` only when it isn't already running — and
 * only then does the models-folder preference matter (a running Ollama has
 * already made that decision). First launch asks the user where models
 * should live; the same dialog is reachable later from the app menu.
 * Ollama started here is deliberately left running on quit: models stay
 * warm and other local tools may be using it.
 */
const { dialog } = require('electron');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const runtime = require('./runtime');
const { loadSettings, saveSettings } = require('./settings');
const { pickFolder } = require('./dialogs');

/**
 * Locate the Ollama desktop app, if installed. Its background mode runs the
 * server so model-runner subprocesses are hidden — unlike a bare, detached
 * `ollama serve`, whose runners each pop a console window on Windows.
 */
function ollamaAppPath() {
  if (!runtime.IS_WINDOWS) return null;
  const roots = [process.env.LOCALAPPDATA, process.env.ProgramFiles, process.env['ProgramFiles(x86)']];
  for (const root of roots) {
    if (!root) continue;
    const exe = path.join(root, 'Programs', 'Ollama', 'ollama app.exe');
    if (fs.existsSync(exe)) return exe;
    const exe2 = path.join(root, 'Ollama', 'ollama app.exe');
    if (fs.existsSync(exe2)) return exe2;
  }
  return null;
}

/** True if an `ollama` process appears to be running (best-effort, Windows). */
function ollamaRunning() {
  return new Promise((resolve) => {
    if (!runtime.IS_WINDOWS) return resolve(false);
    execFile('tasklist', ['/FI', 'IMAGENAME eq ollama.exe'], (err, stdout) => {
      resolve(!err && /ollama\.exe/i.test(stdout));
    });
  });
}

/**
 * Ask where Ollama should store models and persist the answer.
 * First-run flow (allowCancel: false): dismissing means "use the default".
 * Menu flow (allowCancel: true): a Cancel button leaves settings untouched.
 * Resolves to the chosen path, or null for "Ollama's own default".
 */
async function askModelsDir({ allowCancel = false, detail } = {}) {
  const buttons = ['Use Ollama default', 'Choose folder…'];
  if (allowCancel) buttons.push('Cancel');
  const { response } = await dialog.showMessageBox(runtime.win, {
    type: 'question',
    title: 'Monkii — Ollama models',
    message: 'Where should Ollama store its models?',
    detail,
    buttons,
    defaultId: 0,
    cancelId: allowCancel ? 2 : 0,
  });
  if (response === 2) return null; // canceled, nothing saved
  if (response === 1) {
    const p = await pickFolder('Select your Ollama models folder');
    if (p) { saveSettings({ modelsDir: p }); return p; }
    if (allowCancel) return null; // picker dismissed — keep prior setting
  }
  saveSettings({ modelsDir: 'default' });
  return null;
}

/**
 * Decide where Ollama should keep its models, in priority order: the
 * OLLAMA_MODELS env var (never ask), a previously saved choice, or a
 * first-launch dialog. Null means "leave it to Ollama's default".
 */
async function resolveModelsDir() {
  if (process.env.OLLAMA_MODELS) return process.env.OLLAMA_MODELS;

  const saved = loadSettings().modelsDir;
  if (saved === 'default') return null;
  if (saved && fs.existsSync(saved)) return saved;

  return askModelsDir({
    detail: 'Use the Ollama default (~/.ollama/models), or pick a folder — e.g. if your models live on another drive. You can change this later in Preferences.',
  });
}

/** Start `ollama serve` if it isn't already running. Never throws. */
async function ensureOllama() {
  try {
    if (await ollamaRunning()) return;

    const modelsDir = await resolveModelsDir();
    const env = { ...process.env };
    if (modelsDir) env.OLLAMA_MODELS = modelsDir;

    const appExe = ollamaAppPath();
    if (appExe) {
      // Preferred: let the Ollama desktop app host the server. It keeps model
      // runners hidden (no pop-up console windows) and stays up after Monkii
      // quits — the same "leave it running" behavior we already relied on.
      const proc = spawn(appExe, [], { env, detached: true, stdio: 'ignore', windowsHide: true });
      proc.on('error', () => {});
      proc.unref();
      return;
    }

    // Fallback (no desktop app): start `ollama serve` with a HIDDEN console via
    // windowsHide (→ CREATE_NO_WINDOW). Deliberately NOT `detached`, because on
    // Windows detached = DETACHED_PROCESS gives serve *no* console, so every
    // model runner it spawns allocates its own visible console window. With a
    // hidden console the runners inherit it and stay silent.
    const proc = spawn('ollama', ['serve'], { env, stdio: 'ignore', windowsHide: true });
    proc.on('error', () => {}); // ollama not on PATH — the app still runs
    proc.unref();
  } catch { /* non-fatal: the app still runs, just without a local model server */ }
}

module.exports = { ensureOllama, askModelsDir };
