/**
 * settings.js — persisted preferences and storage-location resolution.
 *
 * Settings live in a small JSON file in Electron's per-user data dir
 * (e.g. %APPDATA%\CodeMonkii\settings.json). Keys:
 *   modelsDir — 'default' (Ollama's own ~/.ollama/models) or an absolute path
 *   dataDir   — where projects & chats are stored (absent = default)
 *   skillsDir — where skills are scanned from   (absent = default)
 *
 * Data & skills locations resolve in priority order:
 *   1. CODEMONKII_DATA_DIR / CODEMONKII_SKILLS_DIR env vars — always win;
 *   2. folders picked in the in-app Preferences panel (saved here);
 *   3. defaults — %APPDATA%\CodeMonkii when installed (the install folder is
 *      replaced wholesale on every update, so user data can't live there),
 *      repo-local in dev, same as `npm start`.
 */
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const runtime = require('./runtime');

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try { return JSON.parse(fs.readFileSync(settingsPath(), 'utf8')); }
  catch { return {}; }
}

/** Shallow-merge `patch` into the saved settings (undefined deletes a key). */
function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  try { fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2)); } catch {}
  return next;
}

function defaultStorage() {
  const base = app.isPackaged ? app.getPath('userData') : runtime.APP_ROOT;
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

/** Env block handed to the forked server. Seeds the bundled sample skills
 *  into a fresh skills folder when packaged (never overwriting files). */
function storageEnv() {
  const { dataDir, skillsDir } = effectiveStorage();
  if (app.isPackaged && !fs.existsSync(skillsDir)) {
    try {
      fs.cpSync(path.join(runtime.APP_ROOT, 'skills'), skillsDir, {
        recursive: true, force: false, errorOnExist: false,
      });
    } catch { try { fs.mkdirSync(skillsDir, { recursive: true }); } catch {} }
  }
  return { CODEMONKII_DATA_DIR: dataDir, CODEMONKII_SKILLS_DIR: skillsDir };
}

module.exports = { loadSettings, saveSettings, defaultStorage, effectiveStorage, storageEnv };
