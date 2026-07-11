/**
 * attachments.js — reading project knowledge from disk.
 *
 * Attachments are live references to files/folders on the user's machine:
 * nothing is copied, everything is re-read on each chat request so the model
 * always sees current content. This module knows how to read a single text
 * file safely (binary detection + truncation), walk a directory tree while
 * skipping build artifacts, and assemble everything under strict byte
 * budgets so a big folder can't blow out the model's context window.
 */
const fs = require('fs');
const path = require('path');
const { FILE_LIMIT, DIR_FILE_LIMIT, DIR_MAX_FILES, TOTAL_BUDGET } = require('./config');
const { pathAllowed } = require('./security');

const SKIP_DIRS = new Set(['node_modules', '.git', '.svn', 'dist', 'build', 'out',
  '__pycache__', '.venv', 'venv', '.next', '.cache', 'coverage', 'vendor']);
const BINARY_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip',
  '.gz', '.7z', '.rar', '.exe', '.dll', '.so', '.dylib', '.bin', '.woff', '.woff2', '.ttf',
  '.otf', '.mp3', '.mp4', '.wav', '.mov', '.avi', '.sqlite', '.db', '.safetensors', '.ckpt',
  '.pt', '.pth', '.gguf', '.docx', '.xlsx', '.pptx', '.psd']);

function looksBinary(buf) {
  const n = Math.min(buf.length, 1024);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

function readTextFile(file, limit) {
  const st = fs.statSync(file);
  if (BINARY_EXT.has(path.extname(file).toLowerCase())) return null;
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(Math.min(st.size, limit));
    fs.readSync(fd, buf, 0, buf.length, 0);
    if (looksBinary(buf)) return null;
    let text = buf.toString('utf8');
    if (st.size > limit) text += `\n… [truncated: file is ${st.size} bytes, showing first ${limit}]`;
    return text;
  } finally { fs.closeSync(fd); }
}

function walkDir(dir, out, depth) {
  if (depth > 5 || out.files.length >= DIR_MAX_FILES || out.budget <= 0) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (out.files.length >= DIR_MAX_FILES || out.budget <= 0) return;
    if (e.name.startsWith('.') && e.name !== '.env.example') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walkDir(full, out, depth + 1);
    } else if (e.isFile()) {
      try {
        const text = readTextFile(full, Math.min(DIR_FILE_LIMIT, out.budget));
        if (text !== null && text.trim()) {
          out.files.push({ path: full, text });
          out.budget -= text.length;
        }
      } catch { /* unreadable, skip */ }
    }
  }
}

/* Renders a list of attachments ({ path, type }) into <file> blocks plus a
 * list of per-attachment problems (binary, over budget, outside the allowlist).
 * The list is the project's attachments merged with the chat's own. */
function attachmentContext(attachments) {
  const parts = [];
  const errors = [];
  let budget = TOTAL_BUDGET;
  for (const att of attachments) {
    if (budget <= 0) { errors.push(`${att.path}: skipped (context budget exhausted)`); continue; }
    // re-check at read time: attachments may pre-date a newly configured allowlist
    if (!pathAllowed(att.path)) { errors.push(`${att.path}: outside MONKII_FS_ROOTS, not included`); continue; }
    try {
      if (att.type === 'file') {
        const text = readTextFile(att.path, Math.min(FILE_LIMIT, budget));
        if (text === null) { errors.push(`${att.path}: binary file, not included`); continue; }
        budget -= text.length;
        parts.push(`<file path="${att.path}">\n${text}\n</file>`);
      } else {
        const out = { files: [], budget: Math.min(budget, TOTAL_BUDGET) };
        walkDir(att.path, out, 0);
        for (const f of out.files) {
          budget -= f.text.length;
          parts.push(`<file path="${f.path}">\n${f.text}\n</file>`);
        }
        if (out.files.length >= DIR_MAX_FILES) errors.push(`${att.path}: directory truncated to ${DIR_MAX_FILES} files`);
      }
    } catch (e) { errors.push(`${att.path}: ${e.message}`); }
  }
  return { parts, errors };
}

module.exports = { attachmentContext, readTextFile };
