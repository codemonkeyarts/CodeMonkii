/**
 * routes/projects.js — REST endpoints for projects, chats, and attachments.
 *
 * CRUD for the project entity and its two nested collections: chats
 * (conversation containers, messages are appended by the chat route) and
 * attachments (path references validated against the filesystem allowlist).
 * All persistence goes through lib/store.
 */
const fs = require('fs');
const express = require('express');
const { newId, loadProject, saveProject, deleteProject, listProjects } = require('../lib/store');
const { pathAllowed } = require('../lib/security');
const { sanitizeOptions } = require('../lib/options');

const router = express.Router();

/* ---- projects ---- */

router.get('/projects', (req, res) => {
  res.json(listProjects().map(p => ({
    id: p.id, name: p.name, createdAt: p.createdAt,
    chatCount: p.chats.length, skillCount: p.skills.length,
    attachmentCount: p.attachments.length,
  })));
});

router.post('/projects', (req, res) => {
  const p = {
    id: newId(),
    name: (req.body.name || 'Untitled project').slice(0, 120),
    instructions: req.body.instructions || '',
    createdAt: Date.now(),
    skills: [],        // skill ids always loaded for this project
    attachments: [],   // { id, path, type: 'file'|'dir' }
    options: {},       // Ollama generation options (num_ctx, temperature, …)
    chats: [],         // { id, title, model, createdAt, messages: [{role, content, ts}] }
  };
  saveProject(p);
  res.json(p);
});

router.get('/projects/:pid', (req, res) => {
  try { res.json(loadProject(req.params.pid)); }
  catch { res.status(404).json({ error: 'project not found' }); }
});

router.put('/projects/:pid', (req, res) => {
  try {
    const p = loadProject(req.params.pid);
    if (typeof req.body.name === 'string') p.name = req.body.name.slice(0, 120);
    if (typeof req.body.instructions === 'string') p.instructions = req.body.instructions;
    if (Array.isArray(req.body.skills)) {
      p.skills = req.body.skills
        .filter(s => typeof s === 'string' && !/[\\/]|\.\./.test(s))
        .slice(0, 200);
    }
    if (req.body.options && typeof req.body.options === 'object') {
      p.options = sanitizeOptions(req.body.options);
    }
    saveProject(p);
    res.json(p);
  } catch { res.status(404).json({ error: 'project not found' }); }
});

router.delete('/projects/:pid', (req, res) => {
  try { deleteProject(req.params.pid); res.json({ ok: true }); }
  catch { res.status(404).json({ error: 'project not found' }); }
});

/* ---- chats ---- */

router.post('/projects/:pid/chats', (req, res) => {
  try {
    const p = loadProject(req.params.pid);
    const chat = { id: newId(), title: 'New chat', model: req.body.model || '', createdAt: Date.now(), messages: [] };
    p.chats.unshift(chat);
    saveProject(p);
    res.json(chat);
  } catch { res.status(404).json({ error: 'project not found' }); }
});

router.delete('/projects/:pid/chats/:cid', (req, res) => {
  try {
    const p = loadProject(req.params.pid);
    p.chats = p.chats.filter(c => c.id !== req.params.cid);
    saveProject(p);
    res.json({ ok: true });
  } catch { res.status(404).json({ error: 'project not found' }); }
});

router.put('/projects/:pid/chats/:cid', (req, res) => {
  try {
    const p = loadProject(req.params.pid);
    const c = p.chats.find(c => c.id === req.params.cid);
    if (!c) return res.status(404).json({ error: 'chat not found' });
    if (typeof req.body.title === 'string') c.title = req.body.title.slice(0, 120);
    saveProject(p);
    res.json(c);
  } catch { res.status(404).json({ error: 'project not found' }); }
});

/* ---- attachments ---- */

router.post('/projects/:pid/attachments', (req, res) => {
  try {
    const p = loadProject(req.params.pid);
    const target = req.body.path;
    if (typeof target !== 'string' || !target.trim()) throw new Error('missing path');
    if (!pathAllowed(target)) throw new Error('path outside MONKII_FS_ROOTS');
    const st = fs.statSync(target);
    if (p.attachments.some(a => a.path === target)) return res.json(p);
    p.attachments.push({ id: newId(), path: target, type: st.isDirectory() ? 'dir' : 'file' });
    saveProject(p);
    res.json(p);
  } catch (e) { res.status(400).json({ error: String(e.message || e) }); }
});

router.delete('/projects/:pid/attachments/:aid', (req, res) => {
  try {
    const p = loadProject(req.params.pid);
    p.attachments = p.attachments.filter(a => a.id !== req.params.aid);
    saveProject(p);
    res.json(p);
  } catch { res.status(404).json({ error: 'project not found' }); }
});

module.exports = router;
