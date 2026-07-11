/**
 * api.js — thin JSON client for the Monkii backend.
 *
 * Wraps fetch with JSON headers/body handling and turns non-2xx responses
 * into thrown Errors carrying the server's error message, so callers can
 * simply try/catch and toast. (The streaming /api/chat call does NOT go
 * through here — chat.js consumes that stream directly.)
 */
export async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
