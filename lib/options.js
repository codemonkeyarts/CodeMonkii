/**
 * options.js — Ollama generation options, sanitized.
 *
 * These map to the `options` object of Ollama's /api/chat call and are set
 * per project in the model-settings panel. Everything crossing the wire to
 * Ollama passes through sanitizeOptions first: only known keys survive,
 * numerics are coerced and dropped if non-finite, `stop` becomes a bounded
 * string array, and `keep_alive` (a top-level chat param, not an option) is
 * kept for the caller to split out. Empty/absent values mean "use the
 * model's default" and are simply omitted.
 */
const NUMERIC = [
  'num_ctx', 'temperature', 'num_predict', 'mirostat', 'mirostat_eta',
  'mirostat_tau', 'num_gqa', 'num_thread', 'repeat_last_n', 'repeat_penalty',
  'seed', 'tfs_z', 'top_k', 'top_p', 'min_p',
];

function sanitizeOptions(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;

  for (const key of NUMERIC) {
    const v = raw[key];
    if (v === '' || v == null) continue;
    const n = Number(v);
    if (Number.isFinite(n)) out[key] = n;
  }
  // cap num_ctx server-side too (the UI self-caps): a huge context is a
  // local memory-exhaustion foot-gun, and this is the authoritative check
  if (out.num_ctx) out.num_ctx = Math.min(Math.max(out.num_ctx, 256), 262144);

  if (Array.isArray(raw.stop)) {
    out.stop = raw.stop.filter(s => typeof s === 'string' && s).slice(0, 8);
  } else if (typeof raw.stop === 'string' && raw.stop.trim()) {
    out.stop = raw.stop.split(',').map(s => s.trim()).filter(Boolean).slice(0, 8);
  }
  if (out.stop && !out.stop.length) delete out.stop;

  if (raw.keep_alive !== '' && raw.keep_alive != null) {
    out.keep_alive = typeof raw.keep_alive === 'number'
      ? raw.keep_alive
      : String(raw.keep_alive).trim().slice(0, 16);
  }
  return out;
}

module.exports = { sanitizeOptions };
