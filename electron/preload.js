/**
 * electron/preload.js — secure bridge between the web UI and the desktop shell.
 *
 * Runs with contextIsolation on; the page gets exactly one global,
 * `window.codemonkii`, carrying the handful of desktop-only capabilities the
 * UI needs (preferences, native folder picker). In plain browser mode this
 * global simply doesn't exist and the UI hides its desktop-only controls.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('codemonkii', {
  desktop: true,

  /** Current preferences summary: { modelsDir, envOverride }. */
  getPrefs: () => ipcRenderer.invoke('prefs:get'),

  /** Open the native folder picker; saves + returns new summary (or null if canceled). */
  chooseModelsDir: () => ipcRenderer.invoke('prefs:choose-models-dir'),

  /** Reset to Ollama's own default location; returns new summary. */
  setModelsDefault: () => ipcRenderer.invoke('prefs:set-models-default'),

  /** Menu-bar actions (open project, new project, invoke skill) → UI. */
  onMenuAction: (cb) => ipcRenderer.on('menu:action', (_e, msg) => cb(msg)),

  /** Data & skills folders — these restart the server and reload the UI. */
  chooseDataDir: () => ipcRenderer.invoke('prefs:choose-data-dir'),
  resetDataDir: () => ipcRenderer.invoke('prefs:reset-data-dir'),
  chooseSkillsDir: () => ipcRenderer.invoke('prefs:choose-skills-dir'),
  resetSkillsDir: () => ipcRenderer.invoke('prefs:reset-skills-dir'),
});
