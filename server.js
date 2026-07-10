/* CodeMonkii — local LLM studio for Ollama
 * Projects + Claude-style skills + local file/directory knowledge.
 * Zero-build: Express serves ./public, data persisted as JSON under ./data.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

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
const OLLAMA = normalizeOllamaHost(process.env.OLLAMA_HOST);
const PORT = process.env.PORT || 8113;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data', 'projects');
const SKILLS_DIR = process.env.CODEMONKII_SKILLS_DIR || path.join(ROOT, 'skills');

// context budgets (bytes of text pulled from disk per request)
const FILE_LIMIT = 120 * 1024;      // per attached file
const DIR_FILE_LIMIT = 48 * 1024;   // per file inside an attached directory
const DIR_MAX_FILES = 60;           // files per attached directory
const TOTAL_BUDGET = 480 * 1024;    // all attachments combined
const HISTORY_LIMIT = 40;           // messages of chat history sent to the model

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(SKILLS_DIR, { recursive: true });

const app = express();
app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(ROOT, 'public')));

const id = () => crypto.randomBytes(6).toString('hex');

/* ---------------- projects ---------------- */

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

app.get('/api/projects', (req, res) => {
  res.json(listProjects().map(p => ({
    id: p.id, name: p.name, createdAt: p.createdAt,
    chatCount: p.chats.length, skillCount: p.skills.length,
    attachmentCount: p.attachments.length,
  })));
});

app.post('/api/projects', (req, res) => {
  const p = {
    id: id(),
    name: (req.body.name || 'Untitled project').slice(0, 120),
    instructions: req.body.instructions || '',
    createdAt: Date.now(),
    skills: [],        // skill ids always loaded for this project
    attachments: [],   // { id, path, type: 'file'|'dir' }
    chats: [],         // { id, title, model, createdAt, messages: [{role, content, ts}] }
  };
  saveProject(p);
  res.json(p);
});

app.get('/api/projects/:pid', (req, res) => {
  try { res.json(loadProject(req.params.pid)); }
  catch { res.status(404).json({ error: 'project not found' }); }
});

app.put('/api/projects/:pid', (req, res) => {
  try {
    const p = loadProject(req.params.pid);
    if (typeof req.body.name === 'string') p.name = req.body.name.slice(0, 120);
    if (typeof req.body.instructions === 'string') p.instructions = req.body.instructions;
    if (Array.isArray(req.body.skills)) p.skills = req.body.skills;
    saveProject(p);
    res.json(p);
  } catch { res.status(404).json({ error: 'project not found' }); }
});

app.delete('/api/projects/:pid', (req, res) => {
  try { fs.unlinkSync(projectPath(req.params.pid)); res.json({ ok: true }); }
  catch { res.status(404).json({ error: 'project not found' }); }
});

/* ---------------- chats ---------------- */

app.post('/api/projects/:pid/chats', (req, res) => {
  try {
    const p = loadProject(req.params.pid);
    const chat = { id: id(), title: 'New chat', model: req.body.model || '', createdAt: Date.now(), messages: [] };
    p.chats.unshift(chat);
    saveProject(p);
    res.json(chat);
  } catch { res.status(404).json({ error: 'project not found' }); }
});

app.delete('/api/projects/:pid/chats/:cid', (req, res) => {
  try {
    const p = loadProject(req.params.pid);
    p.chats = p.chats.filter(c => c.id !== req.params.cid);
    saveProject(p);
    res.json({ ok: true });
  } catch { res.status(404).json({ error: 'project not found' }); }
});

app.put('/api/projects/:pid/chats/:cid', (req, res) => {
  try {
    const p = loadProject(req.params.pid);
    const c = p.chats.find(c => c.id === req.params.cid);
    if (!c) return res.status(404).json({ error: 'chat not found' });
    if (typeof req.body.title === 'string') c.title = req.body.title.slice(0, 120);
    saveProject(p);
    res.json(c);
  } catch { res.status(404).json({ error: 'project not found' }); }
});

/* ---------------- skills (Claude-style SKILL.md) ---------------- */

function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  let curKey = null;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s?(.*)$/);
    if (kv) { curKey = kv[1]; meta[curKey] = kv[2].trim(); }
    else if (curKey && /^\s+\S/.test(line)) meta[curKey] += ' ' + line.trim(); // folded multiline
  }
  return { meta, body: m[2] };
}

function scanSkills() {
  const skills = [];
  for (const entry of fs.readdirSync(SKILLS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillFile = path.join(SKILLS_DIR, entry.name, 'SKILL.md');
    if (!fs.existsSync(skillFile)) continue;
    try {
      const raw = fs.readFileSync(skillFile, 'utf8');
      const { meta, body } = parseFrontmatter(raw);
      skills.push({
        id: entry.name,
        name: meta.name || entry.name,
        description: meta.description || '',
        size: body.length,
      });
    } catch { /* skip unreadable skill */ }
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

function skillBody(sid) {
  if (/[\\/]|\.\./.test(sid)) throw new Error('bad skill id');
  const raw = fs.readFileSync(path.join(SKILLS_DIR, sid, 'SKILL.md'), 'utf8');
  const { meta, body } = parseFrontmatter(raw);
  return { meta, body };
}

app.get('/api/skills', (req, res) => res.json({ dir: SKILLS_DIR, skills: scanSkills() }));

app.get('/api/skills/:sid', (req, res) => {
  try { res.json(skillBody(req.params.sid)); }
  catch { res.status(404).json({ error: 'skill not found' }); }
});

/* ---------------- local filesystem browsing + attachments ---------------- */

function listDrives() {
  const drives = [];
  for (let i = 65; i <= 90; i++) {
    const d = String.fromCharCode(i) + ':\\';
    try { fs.accessSync(d); drives.push(d); } catch { /* not mounted */ }
  }
  return drives;
}

app.get('/api/fs', (req, res) => {
  const dir = req.query.dir || os.homedir();
  if (dir === '__drives__') {
    return res.json({ dir: '__drives__', entries: listDrives().map(d => ({ name: d, path: d, isDir: true })) });
  }
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

app.post('/api/projects/:pid/attachments', (req, res) => {
  try {
    const p = loadProject(req.params.pid);
    const target = req.body.path;
    const st = fs.statSync(target);
    if (p.attachments.some(a => a.path === target)) return res.json(p);
    p.attachments.push({ id: id(), path: target, type: st.isDirectory() ? 'dir' : 'file' });
    saveProject(p);
    res.json(p);
  } catch (e) { res.status(400).json({ error: String(e.message || e) }); }
});

app.delete('/api/projects/:pid/attachments/:aid', (req, res) => {
  try {
    const p = loadProject(req.params.pid);
    p.attachments = p.attachments.filter(a => a.id !== req.params.aid);
    saveProject(p);
    res.json(p);
  } catch { res.status(404).json({ error: 'project not found' }); }
});

/* ---- reading attachments into context ---- */

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

function attachmentContext(project) {
  const parts = [];
  const errors = [];
  let budget = TOTAL_BUDGET;
  for (const att of project.attachments) {
    if (budget <= 0) { errors.push(`${att.path}: skipped (context budget exhausted)`); continue; }
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

/* ---------------- system prompt assembly ---------------- */

function buildSystem(project, extraSkillIds) {
  const sections = [];
  sections.push(
    'You are a capable assistant running locally. Answer directly and helpfully. ' +
    'When project files are provided, ground your answers in them and cite file paths.'
  );
  if (project.instructions && project.instructions.trim()) {
    sections.push(`# Project instructions\n${project.instructions.trim()}`);
  }
  const skillIds = [...new Set([...(project.skills || []), ...(extraSkillIds || [])])];
  for (const sid of skillIds) {
    try {
      const { meta, body } = skillBody(sid);
      sections.push(`# Skill: ${meta.name || sid}\n${meta.description ? meta.description + '\n\n' : ''}${body.trim()}`);
    } catch { /* skill removed from disk; ignore */ }
  }
  if (project.attachments.length) {
    const { parts, errors } = attachmentContext(project);
    if (parts.length) {
      sections.push(`# Project knowledge\nThe user attached these files from their machine (read live from disk):\n\n${parts.join('\n\n')}`);
    }
    if (errors.length) sections.push(`# Attachment notes\n${errors.join('\n')}`);
  }
  return sections.join('\n\n---\n\n');
}

/* ---------------- Ollama proxy ---------------- */

app.get('/api/health', async (req, res) => {
  try {
    const r = await fetch(`${OLLAMA}/api/version`, { signal: AbortSignal.timeout(2500) });
    res.json({ ok: true, ollama: OLLAMA, version: (await r.json()).version });
  } catch {
    res.json({ ok: false, ollama: OLLAMA });
  }
});

app.get('/api/models', async (req, res) => {
  try {
    const r = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(4000) });
    const data = await r.json();
    res.json({ models: (data.models || []).map(m => ({ name: m.name, size: m.size, family: m.details && m.details.family })) });
  } catch (e) {
    res.status(502).json({ error: `Cannot reach Ollama at ${OLLAMA}. Is it running?` });
  }
});

app.post('/api/chat', async (req, res) => {
  const { projectId, chatId, message, model, skillIds = [], options = {} } = req.body;
  let project, chat;
  try {
    project = loadProject(projectId);
    chat = project.chats.find(c => c.id === chatId);
    if (!chat) throw new Error('chat not found');
  } catch (e) {
    return res.status(404).json({ error: String(e.message || e) });
  }
  if (!model) return res.status(400).json({ error: 'no model selected' });
  if (!message || !message.trim()) return res.status(400).json({ error: 'empty message' });

  chat.messages.push({ role: 'user', content: message, ts: Date.now(), skillIds });
  if (chat.title === 'New chat') chat.title = message.trim().slice(0, 60);
  chat.model = model;
  saveProject(project);

  const system = buildSystem(project, skillIds);
  const messages = [
    { role: 'system', content: system },
    ...chat.messages.slice(-HISTORY_LIMIT).map(m => ({ role: m.role, content: m.content })),
  ];

  const ac = new AbortController();
  // fires when the client disconnects mid-stream (req 'close' fires too early in modern Node)
  res.on('close', () => { if (!res.writableEnded) ac.abort(); });

  let upstream;
  try {
    upstream = await fetch(`${OLLAMA}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: true, options }),
      signal: ac.signal,
    });
  } catch {
    return res.status(502).json({ error: `Cannot reach Ollama at ${OLLAMA}. Is it running?` });
  }
  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => '');
    let detail = errText;
    try { detail = JSON.parse(errText).error || errText; } catch { /* raw */ }
    return res.status(upstream.status).json({ error: detail || `Ollama error ${upstream.status}` });
  }

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');

  let acc = '';
  let buffered = '';
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunkText = decoder.decode(value, { stream: true });
      buffered += chunkText;
      let nl;
      while ((nl = buffered.indexOf('\n')) >= 0) {
        const line = buffered.slice(0, nl).trim();
        buffered = buffered.slice(nl + 1);
        if (!line) continue;
        try {
          const obj = JSON.parse(line);
          if (obj.message && obj.message.content) acc += obj.message.content;
        } catch { /* partial line */ }
      }
      res.write(value);
    }
  } catch { /* client aborted or upstream died — save what we have */ }

  if (acc) {
    // reload in case another request touched the project while streaming
    try {
      const fresh = loadProject(projectId);
      const freshChat = fresh.chats.find(c => c.id === chatId);
      if (freshChat) {
        freshChat.messages.push({ role: 'assistant', content: acc, ts: Date.now(), model });
        saveProject(fresh);
      }
    } catch { /* project deleted mid-stream */ }
  }
  res.end();
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`CodeMonkii running at http://localhost:${PORT}`);
  console.log(`Ollama host: ${OLLAMA}`);
  console.log(`Skills dir:  ${SKILLS_DIR}`);
});
