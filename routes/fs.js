/**
 * routes/fs.js — filesystem browsing for the attach dialog.
 *
 * Powers the in-app file browser: lists a directory's entries (directories
 * first), exposes a "__drives__" pseudo-directory that enumerates drive
 * letters — or, when MONKII_FS_ROOTS is set, the allowed roots instead —
 * and refuses to look outside the allowlist.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const express = require('express');
const { FS_ROOTS } = require('../lib/config');
const { pathAllowed } = require('../lib/security');

const router = express.Router();

function listDrives() {
  const drives = [];
  for (let i = 65; i <= 90; i++) {
    const d = String.fromCharCode(i) + ':\\';
    try { fs.accessSync(d); drives.push(d); } catch { /* not mounted */ }
  }
  return drives;
}

router.get('/fs', (req, res) => {
  const fallback = FS_ROOTS.length ? FS_ROOTS[0] : os.homedir();
  const dir = req.query.dir || fallback;
  if (dir === '__drives__') {
    // with an allowlist configured, "Drives" shows the allowed roots instead
    const tops = FS_ROOTS.length ? FS_ROOTS : listDrives();
    return res.json({ dir: '__drives__', entries: tops.map(d => ({ name: d, path: d, isDir: true })) });
  }
  if (!pathAllowed(dir)) return res.status(403).json({ error: 'path outside MONKII_FS_ROOTS' });
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => !e.name.startsWith('$') && e.name !== 'System Volume Information')
      .map(e => ({ name: e.name, path: path.join(dir, e.name), isDir: e.isDirectory() }))
      .sort((a, b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name));
    res.json({ dir: path.resolve(dir), parent: path.dirname(path.resolve(dir)), entries });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

module.exports = router;
