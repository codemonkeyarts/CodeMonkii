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
const { OLLAMA, HISTORY_LIMIT, DEFAULT_CONTEXT, EMBED_MODEL_DEFAULT, EMBED_MODEL_SIZE, CHAT_MODEL_DEFAULT, CHAT_MODEL_SIZE } = require('../lib/config');
const { loadProject, saveProject } = require('../lib/store');
const { sanitizeOptions } = require('../lib/options');
const { buildSystem } = require('../lib/prompt');
const { estimateTokens } = require('../lib/tokens');
const { logError } = require('../lib/log');
const { pipeNdjson } = require('../lib/stream');
const ollama = require('../lib/ollama');
const { embedStatus, isEmbedName, indexStatusFor } = require('../lib/retrieval');
const pkg = require('../package.json');

const router = express.Router();

/* App metadata for the About dialog. `buildDate` is baked into the packaged
 * package.json by scripts/build-info.js; absent in a dev checkout. */
router.get('/about', (req, res) => {
  res.json({
    name: 'Monkii',
    version: pkg.version,
    buildDate: pkg.buildDate || null,
    repo: 'https://github.com/codalanguez/Monkii',
  });
});

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

/* Rich metadata for one model (for the model info box). */
router.get('/models/info', async (req, res) => {
  const name = typeof req.query.name === 'string' ? req.query.name.trim() : '';
  if (!name) return res.status(400).json({ error: 'model name required' });
  try { res.json(await ollama.showModel(name)); }
  catch { res.status(502).json({ error: 'cannot reach Ollama or model not found' }); }
});

/* Stream a model pull's progress (NDJSON) straight through to the browser. */
router.post('/models/pull', async (req, res) => {
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  if (!name) return res.status(400).json({ error: 'model name required' });

  const ac = new AbortController();
  res.on('close', () => { if (!res.writableEnded) ac.abort(); });

  let up;
  try { up = await ollama.pullModel(name, ac.signal); }
  catch (e) { logError(`model pull "${name}"`, e); return res.status(502).json({ error: `Cannot reach Ollama at ${OLLAMA}` }); }
  if (!up.ok) {
    const t = await up.text().catch(() => '');
    logError(`model pull "${name}"`, t || `status ${up.status}`);
    return res.status(up.status).json({ error: t || `pull failed (${up.status})` });
  }

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  // Ollama reports pull failures as an {error} event inside a 200 stream — log
  // it while still forwarding everything to the client.
  try {
    await pipeNdjson(up, res, (o) => { if (o.error) logError(`model pull "${name}"`, o.error); });
  } catch (e) { if (!ac.signal.aborted) logError(`model pull stream "${name}"`, e); }
  res.end();
});

/* Delete a model. Name comes as a query param since it can contain "/" and ":". */
router.delete('/models', async (req, res) => {
  const name = typeof req.query.name === 'string' ? req.query.name.trim() : '';
  if (!name) return res.status(400).json({ error: 'model name required' });
  try { await ollama.deleteModel(name); res.json({ ok: true }); }
  catch (e) { logError(`model delete "${name}"`, e); res.status(400).json({ error: String(e.message || e) }); }
});

router.get('/update-check', async (req, res) => res.json(await ollama.checkOllamaUpdate()));

/* Whether an embedding model (for large-attachment retrieval) is installed,
 * plus the recommended one to pull if not. */
router.get('/embed-status', async (req, res) => {
  try { res.json(await embedStatus()); }
  catch { res.json({ installed: false, name: null, recommended: EMBED_MODEL_DEFAULT, size: EMBED_MODEL_SIZE }); }
});

/* Whether any chat model (a non-embedding model) is installed, plus the small
 * default to pull if not — so a clean install can start chatting immediately. */
router.get('/chat-status', async (req, res) => {
  try {
    const names = (await ollama.listModels()).map(m => m.name);
    res.json({ hasChatModel: names.some(n => !isEmbedName(n)), recommended: CHAT_MODEL_DEFAULT, size: CHAT_MODEL_SIZE });
  } catch { res.json({ hasChatModel: false, recommended: CHAT_MODEL_DEFAULT, size: CHAT_MODEL_SIZE }); }
});

/* Background-indexing progress for a set of attachment paths (for the UI badge).
 * POST because Windows paths don't survive query strings cleanly. */
router.post('/index-status', (req, res) => {
  const paths = Array.isArray(req.body.paths) ? req.body.paths.filter(p => typeof p === 'string').slice(0, 500) : [];
  res.json({ statuses: indexStatusFor(paths) });
});

/* Estimated token cost of the fixed part of a request (system prompt +
 * history), plus the context limit, so the composer can warn before overflow.
 * Cheap heuristic — see lib/tokens. */
router.post('/context', async (req, res) => {
  const { projectId, chatId, skillIds = [] } = req.body;
  try {
    const project = loadProject(projectId);
    const chat = project.chats.find(c => c.id === chatId);
    if (!chat) throw new Error('chat not found');
    // use the latest user turn as the retrieval query so the estimate reflects
    // the retrieval-capped size (not a full dump) for big attachments
    const lastUser = [...chat.messages].reverse().find(m => m.role === 'user');
    const system = await buildSystem(project, skillIds, chat, lastUser ? lastUser.content : '');
    const history = chat.messages.slice(-HISTORY_LIMIT).map(m => m.content).join('\n');
    const systemTokens = estimateTokens(system);
    const baseTokens = systemTokens + estimateTokens(history);
    const limit = sanitizeOptions(project.options || {}).num_ctx || DEFAULT_CONTEXT;
    // systemTokens is the floor: dropping history can't get a request below it,
    // so the client uses it to tell "compact-able" from "can't compact" overflow
    res.json({ baseTokens, systemTokens, limit });
  } catch (e) { res.status(404).json({ error: String(e.message || e) }); }
});

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

  const system = await buildSystem(project, skillIds, chat, message);
  const history = chat.messages.slice(-HISTORY_LIMIT).map(m => ({ role: m.role, content: m.content }));

  // Compact to fit the context: drop the oldest history messages until the
  // estimated request fits num_ctx, always keeping the system prompt and the
  // latest message. (Stored history is untouched — only this request is trimmed.)
  const limit = sanitizeOptions(project.options || {}).num_ctx || DEFAULT_CONTEXT;
  const sysTokens = estimateTokens(system);
  const fits = (msgs) => sysTokens + msgs.reduce((n, m) => n + estimateTokens(m.content), 0) <= limit;
  while (history.length > 1 && !fits(history)) history.shift();

  // Safety net: if even the system prompt + one message can't fit (usually a
  // large attachment), don't hand Ollama a doomed request — return a clear,
  // actionable error instead of its cryptic "exceeds context size" one.
  if (!fits(history)) {
    const needK = Math.max(1, Math.round((sysTokens + estimateTokens(history[history.length - 1]?.content || '')) / 1000));
    return res.status(413).json({
      error: `This request needs about ${needK}k tokens but the context length is set to ${limit >= 1024 ? Math.round(limit / 1024) + 'k' : limit}. Raise the context length in Model settings, use a model with a larger context, or attach less.`,
    });
  }

  const messages = [{ role: 'system', content: system }, ...history];

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
  } catch (e) {
    logError(`chat "${model}" — request failed`, e);
    // Distinguish "Ollama is down" from "the request failed while Ollama is up"
    // — a dropped connection usually means the model runner crashed, most often
    // out of memory from too high a context length for the GPU.
    let reachable = false;
    try { await ollama.getVersion(); reachable = true; } catch { /* really down */ }
    if (reachable) {
      const n = clean.num_ctx;
      const ctxNote = n ? ` (context length is ${n >= 1024 ? Math.round(n / 1024) + 'k' : n})` : '';
      return res.status(502).json({
        error: `${model} failed to respond — the model likely ran out of memory or timed out loading${ctxNote}. ` +
          `Lower the context length in Model settings, or pick a smaller model.`,
      });
    }
    return res.status(502).json({ error: `Cannot reach Ollama at ${OLLAMA}. Is it running?` });
  }
  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => '');
    let detail = errText;
    try { detail = JSON.parse(errText).error || errText; } catch { /* raw */ }
    logError(`chat "${model}" — Ollama ${upstream.status}`, detail);
    return res.status(upstream.status).json({ error: detail || `Ollama error ${upstream.status}` });
  }

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');

  let acc = '';
  try {
    await pipeNdjson(upstream, res, (obj) => {
      if (obj.message && obj.message.content) acc += obj.message.content;
    });
  } catch (e) {
    // client aborting is normal (Stop button); anything else is worth logging
    if (!ac.signal.aborted) logError(`chat "${model}" — stream error`, e);
  }

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
