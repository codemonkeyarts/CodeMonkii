/**
 * settings.js — persisted preferences and storage-location resolution.
 *
 * Settings live in a small JSON file in Electron's per-user data dir
 * (e.g. %APPDATA%\Monkii\settings.json). Keys:
 *   modelsDir — 'default' (Ollama's own ~/.ollama/models) or an absolute path
 *   dataDir   — where projects & chats are stored (absent = default)
 *   skillsDir — where skills are scanned from   (absent = default)
 *
 * Data & skills locations resolve in priority order:
 *   1. MONKII_DATA_DIR / MONKII_SKILLS_DIR env vars — always win;
 *   2. folders picked in the in-app Preferences panel (saved here);
 *   3. defaults — %APPDATA%\Monkii when installed (the install folder is
 *      replaced wholesale on every update, so user data can't live there),
 *      repo-local in dev, same as `npm start`.
 */
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
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
    dataDir: process.env.MONKII_DATA_DIR || s.dataDir || d.dataDir,
    skillsDir: process.env.MONKII_SKILLS_DIR || s.skillsDir || d.skillsDir,
  };
}

/** Logs live beside the per-user data when installed, repo-local in dev. */
function logDir() {
  const base = app.isPackaged ? app.getPath('userData') : runtime.APP_ROOT;
  return process.env.MONKII_LOG_DIR || path.join(base, 'logs');
}

/* Filesystem allowlist (MONKII_FS_ROOTS). The desktop app fences browsing and
 * attachment reads to your home folder by default; widen it in Preferences.
 * The `fsRoots` setting is either an array of allowed folders, the string 'all'
 * (whole disk), or absent (default = home). The ambient env var always wins. */
function fsRootsSetting() { return loadSettings().fsRoots; }

/** Effective allowed folders. An empty array means the whole disk (no fence). */
function fsRootsList() {
  const env = process.env.MONKII_FS_ROOTS;
  if (env !== undefined) return env.split(';').map(s => s.trim()).filter(Boolean);
  const s = fsRootsSetting();
  if (s === 'all') return [];
  if (Array.isArray(s) && s.length) return s;
  return [os.homedir()];
}
const fsWholeDisk = () => fsRootsList().length === 0;

/** The MONKII_FS_ROOTS value handed to the forked server. */
function fsRootsEnvValue() {
  if (process.env.MONKII_FS_ROOTS !== undefined) return process.env.MONKII_FS_ROOTS;
  const s = fsRootsSetting();
  if (s === 'all') return '';
  if (Array.isArray(s) && s.length) return s.join(';');
  return os.homedir();
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
  return {
    MONKII_DATA_DIR: dataDir,
    MONKII_SKILLS_DIR: skillsDir,
    MONKII_LOG_DIR: logDir(),
    MONKII_FS_ROOTS: fsRootsEnvValue(),
  };
}

module.exports = {
  loadSettings, saveSettings, defaultStorage, effectiveStorage, storageEnv, logDir,
  fsRootsList, fsWholeDisk,
};
