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
