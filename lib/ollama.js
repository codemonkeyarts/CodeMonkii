/**
 * ollama.js — Ollama server client.
 *
 * The only module that talks to the Ollama HTTP API: version/health probes,
 * model listing, and opening a streaming chat. Also owns the release update
 * check, which compares the running Ollama version to the latest GitHub
 * release — cached 24h on success, 15min on failure (Ollama may still be
 * booting when Monkii starts), with concurrent calls deduplicated.
 */
const { OLLAMA, UPDATE_CHECK } = require('./config');

async function getVersion() {
  const r = await fetch(`${OLLAMA}/api/version`, { signal: AbortSignal.timeout(2500) });
  return (await r.json()).version;
}

async function listModels() {
  const r = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(4000) });
  const data = await r.json();
  return (data.models || []).map(m => ({ name: m.name, size: m.size }));
}

/* Rich metadata for one model via /api/show: parameter size, quantization,
 * the trained context length, and capabilities (vision/tools/…). */
async function showModel(name) {
  const r = await fetch(`${OLLAMA}/api/show`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
    signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) throw new Error(`Ollama error ${r.status}`);
  const info = await r.json();
  const d = info.details || {};
  let contextLength = null;
  for (const k in (info.model_info || {})) {
    if (k.endsWith('.context_length')) { contextLength = info.model_info[k]; break; }
  }
  return {
    name,
    parameterSize: d.parameter_size || '',
    quantization: d.quantization_level || '',
    contextLength,
    capabilities: Array.isArray(info.capabilities) ? info.capabilities : [],
  };
}

/* Opens a streaming chat request; returns the upstream fetch Response.
 * The caller owns piping/parsing and can abort via the provided signal.
 * keep_alive (how long the model stays resident) is a top-level param. */
function streamChat({ model, messages, options, keepAlive, signal }) {
  const payload = { model, messages, stream: true, options };
  if (keepAlive !== undefined) payload.keep_alive = keepAlive;
  return fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
}

/* One-shot (non-streaming) chat; returns the reply text. Used for short
 * utility generations like skill scaffolding. Generous timeout: the model
 * may need to load into VRAM first. */
async function chatOnce({ model, messages, timeoutMs = 180000 }) {
  const r = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: false }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) {
    let detail = '';
    try { detail = (await r.json()).error || ''; } catch { /* raw */ }
    throw new Error(detail || `Ollama error ${r.status}`);
  }
  const data = await r.json();
  return (data.message && data.message.content) || '';
}

/* ---- model management ---- */

/* Streaming model pull; returns the upstream fetch Response (NDJSON progress
 * events). The caller pipes it through and can abort via the signal. */
function pullModel(name, signal) {
  return fetch(`${OLLAMA}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, stream: true }),
    signal,
  });
}

async function deleteModel(name) {
  const r = await fetch(`${OLLAMA}/api/delete`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(t || `Ollama error ${r.status}`);
  }
  return true;
}

/* ---- update check ---- */

const CACHE_OK = 24 * 60 * 60 * 1000;
const CACHE_FAIL = 15 * 60 * 1000;
let updateCache = { checkedAt: 0, ok: false, current: null, latest: null, updateAvailable: false, url: 'https://ollama.com/download' };
let updateInFlight = null;

function parseVer(v) {
  const m = String(v || '').match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? [+m[1], +m[2], +m[3]] : null;
}

function checkOllamaUpdate() {
  if (!UPDATE_CHECK) return Promise.resolve(updateCache);
  const maxAge = updateCache.ok ? CACHE_OK : CACHE_FAIL;
  if (Date.now() - updateCache.checkedAt < maxAge) return Promise.resolve(updateCache);
  if (updateInFlight) return updateInFlight;
  updateInFlight = (async () => {
    try {
      const current = await getVersion();
      const rel = await (await fetch('https://api.github.com/repos/ollama/ollama/releases/latest', {
        headers: { 'User-Agent': 'Monkii', Accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(6000),
      })).json();
      const latest = String(rel.tag_name || '').replace(/^v/, '');
      const cv = parseVer(current), lv = parseVer(latest);
      const updateAvailable = !!(cv && lv &&
        (lv[0] > cv[0] || (lv[0] === cv[0] && (lv[1] > cv[1] || (lv[1] === cv[1] && lv[2] > cv[2])))));
      updateCache = { checkedAt: Date.now(), ok: true, current, latest, updateAvailable, url: 'https://ollama.com/download' };
    } catch { /* offline or rate-limited — keep last result, retry after CACHE_FAIL */
      updateCache = { ...updateCache, checkedAt: Date.now(), ok: false };
    }
    updateInFlight = null;
    return updateCache;
  })();
  return updateInFlight;
}

module.exports = {
  getVersion, listModels, showModel, streamChat, chatOnce,
  pullModel, deleteModel, checkOllamaUpdate,
};
