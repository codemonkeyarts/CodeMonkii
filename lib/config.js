/**
 * config.js — central configuration.
 *
 * Every tunable in the app lives here: ports, directory locations, context
 * budgets, and feature switches, all read once from environment variables.
 * Other modules import from this file instead of touching process.env, so
 * there is a single place to see (and change) how CodeMonkii is configured.
 */
const path = require('path');

/* OLLAMA_HOST is often set to a bind address like "0.0.0.0" or "0.0.0.0:11434"
 * for the Ollama server itself — normalize whatever we find into a client URL. */
function normalizeOllamaHost(raw) {
  if (!raw || !raw.trim()) return 'http://localhost:11434';
  let h = raw.trim();
  if (!/^https?:\/\//.test(h)) h = 'http://' + h;
  try {
    const u = new URL(h);
    if (u.hostname === '0.0.0.0') u.hostname = 'localhost';
    if (!u.port) u.port = '11434';
    return u.origin;
  } catch { return 'http://localhost:11434'; }
}

const ROOT = path.join(__dirname, '..');

module.exports = {
  ROOT,
  PORT: process.env.PORT || 8113,
  OLLAMA: normalizeOllamaHost(process.env.OLLAMA_HOST),

  /* storage locations — the desktop app points DATA_DIR at the per-user
   * appdata folder so installed-app updates never touch project data */
  DATA_DIR: process.env.CODEMONKII_DATA_DIR || path.join(ROOT, 'data', 'projects'),
  LOG_DIR: process.env.CODEMONKII_LOG_DIR || path.join(ROOT, 'logs'),
  SKILLS_DIR: process.env.CODEMONKII_SKILLS_DIR || path.join(ROOT, 'skills'),

  /* optional filesystem allowlist: "C:\projects;D:\writing" restricts browsing
   * AND attachment reads to those trees. Empty = whole disk (single-user default). */
  FS_ROOTS: (process.env.CODEMONKII_FS_ROOTS || '')
    .split(';').map(s => s.trim()).filter(Boolean).map(p => path.resolve(p)),

  /* daily Ollama-release check; CODEMONKII_UPDATE_CHECK=off disables it */
  UPDATE_CHECK: (process.env.CODEMONKII_UPDATE_CHECK || 'on').toLowerCase() !== 'off',

  /* context budgets (bytes of text pulled from disk per request) */
  FILE_LIMIT: 120 * 1024,      // per attached file
  DIR_FILE_LIMIT: 48 * 1024,   // per file inside an attached directory
  DIR_MAX_FILES: 60,           // files per attached directory
  TOTAL_BUDGET: 480 * 1024,    // all attachments combined
  SKILL_LIMIT: 64 * 1024,      // per skill body injected into the prompt
  HISTORY_LIMIT: 40,           // messages of chat history sent to the model
  DEFAULT_CONTEXT: 4096,       // assumed num_ctx when the model settings leave it unset

  /* skill import safety caps — skills are text; anything bigger is a mistake */
  IMPORT_MAX_FILES: 400,
  IMPORT_MAX_BYTES: 20 * 1024 * 1024,
};
