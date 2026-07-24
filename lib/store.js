/**
 * store.js — project persistence.
 *
 * Projects (with their chats, attachments, and skill selections) are stored
 * as one pretty-printed JSON file per project under data/projects/, so the
 * user's data is trivially inspectable and backupable. This module owns all
 * per-project reads/writes and the generation of ids. The one exception is
 * routes/backup.js, which reads/wipes the directory in bulk (zip everything,
 * erase everything) rather than one project at a time — a different enough
 * access pattern that it talks to the directory directly instead of looping
 * this module's single-project calls.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR } = require('./config');

fs.mkdirSync(DATA_DIR, { recursive: true });

const newId = () => crypto.randomBytes(6).toString('hex');

function projectPath(pid) {
  if (!/^[a-f0-9]{12}$/.test(pid)) throw new Error('bad project id');
  return path.join(DATA_DIR, pid + '.json');
}

function loadProject(pid) {
  return JSON.parse(fs.readFileSync(projectPath(pid), 'utf8'));
}

function saveProject(p) {
  fs.writeFileSync(projectPath(p.id), JSON.stringify(p, null, 2));
}

function deleteProject(pid) {
  fs.unlinkSync(projectPath(pid));
}

function listProjects() {
  return fs.readdirSync(DATA_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8')); }
      catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => b.createdAt - a.createdAt);
}

module.exports = { newId, loadProject, saveProject, deleteProject, listProjects };
