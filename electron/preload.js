/**
 * electron/preload.js — secure bridge between the web UI and the desktop shell.
 *
 * Runs with contextIsolation on; the page gets exactly one global,
 * `window.monkii`, carrying the handful of desktop-only capabilities the
 * UI needs (preferences, native folder picker). In plain browser mode this
 * global simply doesn't exist and the UI hides its desktop-only controls.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('monkii', {
  desktop: true,

  /** Current preferences summary: { modelsDir, envOverride }. */
  getPrefs: () => ipcRenderer.invoke('prefs:get'),

  /** Open the native folder picker; saves + returns new summary (or null if canceled). */
  chooseModelsDir: () => ipcRenderer.invoke('prefs:choose-models-dir'),

  /** Reset to Ollama's own default location; returns new summary. */
  setModelsDefault: () => ipcRenderer.invoke('prefs:set-models-default'),

  /** Menu-bar actions (open project, new project, invoke skill) → UI. */
  onMenuAction: (cb) => ipcRenderer.on('menu:action', (_e, msg) => cb(msg)),

  /** Native "update Ollama" popup. Returns 'download' | 'later' | 'dismissed'. */
  ollamaUpdatePrompt: (info) => ipcRenderer.invoke('ollama:update-prompt', info),

  /** First-run "download embedding model?" popup. Returns 'download' | 'later' | 'dismissed'. */
  embedModelPrompt: (info) => ipcRenderer.invoke('ollama:embed-prompt', info),

  /** First-run "download a chat model?" popup. Returns 'download' | 'later' | 'dismissed'. */
  chatModelPrompt: (info) => ipcRenderer.invoke('ollama:chat-prompt', info),

  /** Data & skills folders — these restart the server and reload the UI. */
  chooseDataDir: () => ipcRenderer.invoke('prefs:choose-data-dir'),
  resetDataDir: () => ipcRenderer.invoke('prefs:reset-data-dir'),
  chooseSkillsDir: () => ipcRenderer.invoke('prefs:choose-skills-dir'),
  resetSkillsDir: () => ipcRenderer.invoke('prefs:reset-skills-dir'),

  /** File-access allowlist — each restarts the server and reloads the UI. */
  addFsRoot: () => ipcRenderer.invoke('prefs:fs-add-root'),
  removeFsRoot: (p) => ipcRenderer.invoke('prefs:fs-remove-root', p),
  fsWholeDisk: () => ipcRenderer.invoke('prefs:fs-whole-disk'),
  fsResetHome: () => ipcRenderer.invoke('prefs:fs-reset-home'),

  /** Daily Ollama update check (opt-in) — restarts the server. */
  setUpdateCheck: (on) => ipcRenderer.invoke('prefs:set-update-check', on),

  /** Reveal the projects & chats folder in the OS file manager. */
  openDataFolder: () => ipcRenderer.invoke('prefs:open-data-folder'),

  /** Save (or clear, with '') the OpenRouter API key — restarts the server.
   *  Returns the prefs summary; the key itself is never readable back. */
  setOpenRouterKey: (key) => ipcRenderer.invoke('prefs:set-openrouter-key', key),

  /** Remote privacy routing: allow=false (default) restricts remote chats to
   *  providers that don't log/train on prompts. Restarts the server. */
  setOrLogging: (allow) => ipcRenderer.invoke('prefs:set-or-logging', allow),
});
