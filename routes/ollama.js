/**
 * routes/ollama.js — model endpoints: health, model list, update check, and
 * the streaming chat itself.
 *
 * The chat handler is the heart of the app: it appends the user message,
 * builds the full system prompt (instructions + skills + live attachments),
 * pipes Ollama's NDJSON stream straight through to the browser while
 * accumulating the reply server-side, and persists whatever arrived — even
 * if the user hit Stop mid-generation.
 */
const express = require('express');
const { OLLAMA, HISTORY_LIMIT } = require('../lib/config');
const { loadProject, saveProject } = require('../lib/store');
const { sanitizeOptions } = require('../lib/options');
const { buildSystem } = require('../lib/prompt');
const ollama = require('../lib/ollama');

const router = express.Router();

router.get('/health', async (req, res) => {
  try {
    res.json({ ok: true, ollama: OLLAMA, version: await ollama.getVersion() });
  } catch {
    res.json({ ok: false, ollama: OLLAMA });
  }
});

router.get('/models', async (req, res) => {
  try {
    res.json({ models: await ollama.listModels() });
  } catch {
    res.status(502).json({ error: `Cannot reach Ollama at ${OLLAMA}. Is it running?` });
  }
});

router.get('/update-check', async (req, res) => res.json(await ollama.checkOllamaUpdate()));

router.post('/chat', async (req, res) => {
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

  // options come from the project's model settings; keep_alive is a top-level
  // Ollama chat param, not an option, so split it out after sanitizing
  const clean = sanitizeOptions(options);
  const keepAlive = clean.keep_alive;
  delete clean.keep_alive;

  let upstream;
  try {
    upstream = await ollama.streamChat({ model, messages, options: clean, keepAlive, signal: ac.signal });
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

module.exports = router;
