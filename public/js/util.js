/**
 * util.js — small shared DOM helpers.
 *
 * The `$` query shortcut, HTML escaping for anything user- or model-supplied
 * that gets interpolated into innerHTML, the toast notifier, and the
 * auto-growing textarea used by the composer.
 */
export const $ = (sel) => document.querySelector(sel);

export function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

let toastTimer;
export function toast(msg, isError) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = isError ? 'error' : '';
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

export function autoGrow(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 200) + 'px';
}

/** Bytes → "4.7 GB" / "820 MB"; `empty` is returned for 0/undefined. */
export function fmtBytes(n, empty = '') {
  if (!n) return empty;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  return `${(n / 1e6).toFixed(0)} MB`;
}

/** Context length → "16k" / "900"; `empty` is returned for 0/undefined. */
export function fmtCtx(n, empty = '') {
  if (!n) return empty;
  return n >= 1024 ? `${Math.round(n / 1024)}k` : String(n);
}

/** USD-per-token → "$0.32" per million tokens; `empty` for unknown pricing. */
export function fmtPerM(p, empty = '—') {
  if (p == null || Number.isNaN(p)) return empty;
  return `$${(p * 1e6).toFixed(2)}`;
}

/** Async-iterate an NDJSON fetch Response, yielding each parsed object.
 *  Partial/invalid lines are skipped; the caller handles any {error} events. */
export async function* readNdjson(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buffered.indexOf('\n')) >= 0) {
      const line = buffered.slice(0, nl).trim();
      buffered = buffered.slice(nl + 1);
      if (!line) continue;
      let obj;
      try { obj = JSON.parse(line); } catch { continue; }
      yield obj;
    }
  }
}

/* Clipboard write via a transient textarea — works on plain-http localhost
 * and inside the sandboxed desktop renderer, where navigator.clipboard can
 * be unavailable or permission-gated. */
export function copyText(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch { /* clipboard unavailable */ }
  ta.remove();
}
