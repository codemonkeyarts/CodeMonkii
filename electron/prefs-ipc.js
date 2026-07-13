/**
 * prefs-ipc.js — the Preferences panel's IPC surface.
 *
 * The web UI reaches these through the preload bridge (window.monkii).
 * Every handler validates that the call originates from the app's own pages:
 * if the renderer were ever tricked into showing foreign content, that page
 * must not be able to reach the folder pickers or settings.
 *
 * Data & skills changes restart the forked server (it reads config once at
 * boot) and rebuild the menu, whose folder shortcuts reflect the new paths.
 */
const { ipcMain, dialog, shell } = require('electron');
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
    dataDirEnv: process.env.MONKII_DATA_DIR || null,
    skillsDir: eff.skillsDir,
    skillsDirCustom: Boolean(s.skillsDir),
    skillsDirEnv: process.env.MONKII_SKILLS_DIR || null,
  };
}

/** ipcMain.handle, but only for calls from our own UI. */
function handleUI(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!runtime.isAppUrl(event.senderFrame?.url || '')) throw new Error('unauthorized sender');
    return fn(...args);
  });
}

/* Only ever open external links to these hosts, whatever the renderer passes —
 * so a compromised renderer can't turn the update prompt into an open-redirect. */
const EXTERNAL_HOSTS = new Set(['ollama.com', 'www.ollama.com', 'github.com']);
function safeExternalUrl(url, fallback) {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' && EXTERNAL_HOSTS.has(u.hostname)) return u.href;
  } catch { /* not a URL */ }
  return fallback;
}

/**
 * Native "update Ollama" popup, driven by the renderer's daily update check.
 * Shows Download / Later, plus a checkbox that mutes this specific version so
 * we never nag about a release the user chose to skip. Returns the choice.
 */
async function promptOllamaUpdate({ current, latest, url } = {}) {
  if (!latest) return 'noop';
  if (loadSettings().dismissedOllamaUpdate === latest) return 'dismissed';
  const safeUrl = safeExternalUrl(url, 'https://ollama.com/download');
  const { response, checkboxChecked } = await dialog.showMessageBox(runtime.win, {
    type: 'info',
    title: 'Monkii — Ollama update available',
    message: `A newer Ollama is available: ${latest}`,
    detail: `You have ${current || 'an older version'}. Updating is recommended — recent releases also fix the stray console windows that can appear on Windows when a model loads.`,
    buttons: ['Download', 'Later'],
    defaultId: 0,
    cancelId: 1,
    checkboxLabel: "Don't remind me about this version",
    checkboxChecked: false,
    noLink: true,
  });
  if (checkboxChecked) saveSettings({ dismissedOllamaUpdate: latest });
  if (response === 0) { shell.openExternal(safeUrl); return 'download'; }
  return 'later';
}

/**
 * First-run offer to download the embedding model that powers offline
 * large-attachment search. Returns 'download' | 'later' | 'dismissed'.
 * "Don't ask again" is remembered so we never nag.
 */
async function promptEmbedModel({ recommended, size } = {}) {
  if (loadSettings().dismissedEmbedPrompt) return 'dismissed';
  const model = recommended || 'nomic-embed-text';
  const { response, checkboxChecked } = await dialog.showMessageBox(runtime.win, {
    type: 'question',
    title: 'Monkii — offline attachment search',
    message: 'Enable searching large attachments?',
    detail: `Monkii can embed big attachments (a whole manuscript or codebase) on your machine, so only the passages relevant to your question go into each prompt — entirely offline. ` +
      `It needs a small embedding model, ${model}${size ? ` (~${size})` : ''}, downloaded once via Ollama.\n\n` +
      `Without it, large attachments still work — they're just truncated to fit the context.`,
    buttons: ['Download', 'Not now'],
    defaultId: 0,
    cancelId: 1,
    checkboxLabel: "Don't ask again",
    checkboxChecked: false,
    noLink: true,
  });
  if (checkboxChecked) saveSettings({ dismissedEmbedPrompt: true });
  return response === 0 ? 'download' : 'later';
}

/**
 * First-run offer to download a small default chat model so a clean install can
 * chat right away. Returns 'download' | 'later' | 'dismissed'; "Don't ask again"
 * is remembered.
 */
async function promptChatModel({ recommended, size } = {}) {
  if (loadSettings().dismissedChatPrompt) return 'dismissed';
  const model = recommended || 'llama3.2';
  const { response, checkboxChecked } = await dialog.showMessageBox(runtime.win, {
    type: 'question',
    title: 'Monkii — get started',
    message: 'Download a model to chat with?',
    detail: `Monkii talks to models running locally through Ollama, and none are installed yet. ` +
      `Download a small, capable default — ${model}${size ? ` (${size})` : ''} — to start chatting right away? ` +
      `You can pull other models any time from Manage models.`,
    buttons: ['Download', 'Not now'],
    defaultId: 0,
    cancelId: 1,
    checkboxLabel: "Don't ask again",
    checkboxChecked: false,
    noLink: true,
  });
  if (checkboxChecked) saveSettings({ dismissedChatPrompt: true });
  return response === 0 ? 'download' : 'later';
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

  handleUI('ollama:update-prompt', (info) => promptOllamaUpdate(info));
  handleUI('ollama:embed-prompt', (info) => promptEmbedModel(info));
  handleUI('ollama:chat-prompt', (info) => promptChatModel(info));
}

module.exports = { registerPrefsIpc };
