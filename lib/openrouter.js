/**
 * openrouter.js — optional remote-model backend (OpenRouter).
 *
 * Monkii stays local-first: this module is inert until an API key is
 * configured, and only chats whose model carries the "openrouter:" prefix
 * ever touch it. It mirrors lib/ollama.js's surface (listModels, streamChat)
 * but translates at the boundary so the rest of the app keeps speaking
 * Ollama-shaped NDJSON: OpenRouter streams OpenAI-style SSE
 * (`data: {...choices[0].delta.content}` lines, `:` keepalive comments,
 * a final `data: [DONE]`), which streamChat converts into
 * `{message:{content}}` NDJSON lines via a TransformStream. Routes, the
 * stream tee, and the browser parsers never know the difference.
 */
const { OPENROUTER_KEY } = require('./config');

const BASE = 'https://openrouter.ai/api/v1';
const PREFIX = 'openrouter:';

/* Attribution headers OpenRouter asks apps to send; the key never leaves
 * this module. */
function headers() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${OPENROUTER_KEY}`,
    'HTTP-Referer': 'https://github.com/codalanguez/Monkii',
    'X-Title': 'Monkii',
  };
}

const configured = () => Boolean(OPENROUTER_KEY);

/* Remote models are namespaced "openrouter:<vendor/model-id>" everywhere in
 * Monkii (picker values, chat.model on disk) so a stored chat re-opens on the
 * right backend. Ollama names can't collide: their tags never contain "/". */
const isRemote = (name) => typeof name === 'string' && name.startsWith(PREFIX);
const remoteId = (name) => name.slice(PREFIX.length);

/* ---- model catalog (cached 1h — it's a big, slow-moving list) ---- */

let catalog = { at: 0, models: [] };

async function listModels() {
  if (Date.now() - catalog.at < 60 * 60 * 1000 && catalog.models.length) return catalog.models;
  const r = await fetch(`${BASE}/models`, { headers: headers(), signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`OpenRouter models error ${r.status}`);
  const data = await r.json();
  const models = (data.data || []).map(m => ({
    id: m.id,
    name: m.name || m.id,
    contextLength: m.context_length || null,
    // USD per token (strings from the API); the UI turns these into $/M tokens
    promptPrice: m.pricing ? Number(m.pricing.prompt) : null,
    completionPrice: m.pricing ? Number(m.pricing.completion) : null,
  }));
  catalog = { at: Date.now(), models };
  return models;
}

/** Trained context length for a remote model (from the cached catalog). */
function contextLengthFor(name) {
  const m = catalog.models.find(x => x.id === remoteId(name));
  return (m && m.contextLength) || null;
}

/* ---- options: Ollama semantics → OpenAI/OpenRouter semantics ----
 * OpenRouter accepts a superset of OpenAI sampling params, so most survive.
 * num_ctx has no equivalent (context is fixed per model — never sent), and
 * keep_alive / mirostat* / num_thread and friends are local-runtime knobs. */
function mapOptions(o = {}) {
  const out = {};
  if (o.temperature != null) out.temperature = o.temperature;
  if (o.top_p != null) out.top_p = o.top_p;
  if (o.top_k != null) out.top_k = o.top_k;
  if (o.min_p != null) out.min_p = o.min_p;
  if (o.seed != null) out.seed = o.seed;
  if (o.stop) out.stop = o.stop;
  if (o.num_predict != null && o.num_predict > 0) out.max_tokens = o.num_predict;
  if (o.repeat_penalty != null) out.repetition_penalty = o.repeat_penalty;
  return out;
}

/* ---- streaming chat: SSE in, Ollama-shaped NDJSON out ---- */

function sseToNdjson(body) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buf = '';
  const emit = (controller, obj) => controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
  return body.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      buf += decoder.decode(chunk, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line || line.startsWith(':')) continue;        // SSE keepalive comment
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') continue;                 // flush() emits done
        try {
          const o = JSON.parse(payload);
          // mid-stream provider errors arrive as {error:{message}} events
          if (o.error) { emit(controller, { error: o.error.message || String(o.error) }); continue; }
          const delta = o.choices && o.choices[0] && o.choices[0].delta;
          if (delta && delta.content) emit(controller, { message: { content: delta.content } });
        } catch { /* partial line — wait for more bytes */ }
      }
    },
    flush(controller) { emit(controller, { done: true }); }
  }));
}

/**
 * Open a streaming chat. Returns the same shape routes/pipeNdjson expect from
 * ollama.streamChat: on success {ok, status, body} where body is Ollama-shaped
 * NDJSON; on failure the raw Response (so the caller can read .text()).
 */
async function streamChat({ model, messages, options, signal }) {
  const r = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ model: remoteId(model), messages, stream: true, ...mapOptions(options) }),
    signal,
  });
  if (!r.ok) return r;
  return { ok: true, status: r.status, body: sseToNdjson(r.body) };
}

module.exports = { configured, isRemote, remoteId, listModels, contextLengthFor, streamChat, sseToNdjson };
