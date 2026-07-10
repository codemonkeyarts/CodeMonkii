/**
 * prefs-ipc.js — the Preferences panel's IPC surface.
 *
 * The web UI reaches these through the preload bridge (window.codemonkii).
 * Every handler validates that the call originates from the app's own pages:
 * if the renderer were ever tricked into showing foreign content, that page
 * must not be able to reach the folder pickers or settings.
 *
 * Data & skills changes restart the forked server (it reads config once at
 * boot) and rebuild the menu, whose folder shortcuts reflect the new paths.
 */
const { ipcMain } = require('electron');
const runtime = require('./runtime');
const { loadSettings, saveSettings, effectiveStorage } = require('./settings');
const { pickFolder } = require('./dialogs');
const { restartServer } = require('./server');
const { buildMenu } = require('./menu');

/* What the panel sees. For each location: the effective path, whether it
 * came from a user pick, and the env var that (when set) always wins over
 * the saved setting — shown read-only in the UI. */
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

/** ipcMain.handle, but only for calls from our own UI. */
function handleUI(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!runtime.isAppUrl(event.senderFrame?.url || '')) throw new Error('unauthorized sender');
    return fn(...args);
  });
}

/** Save a storage patch, restart the server on it, refresh dependent UI. */
async function applyStorageChange(patch) {
  saveSettings(patch);
  await restartServer();
  await buildMenu();
  return prefsSummary();
}

function registerPrefsIpc() {
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

  handleUI('prefs:choose-data-dir', async () => {
    const p = await pickFolder('Select the folder for projects & chats');
    return p ? applyStorageChange({ dataDir: p }) : null;
  });

  handleUI('prefs:reset-data-dir', () => applyStorageChange({ dataDir: undefined }));

  handleUI('prefs:choose-skills-dir', async () => {
    const p = await pickFolder('Select your skills folder');
    return p ? applyStorageChange({ skillsDir: p }) : null;
  });

  handleUI('prefs:reset-skills-dir', () => applyStorageChange({ skillsDir: undefined }));
}

module.exports = { registerPrefsIpc };
