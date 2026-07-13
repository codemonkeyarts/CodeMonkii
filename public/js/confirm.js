/**
 * confirm.js — a small in-app confirmation dialog.
 *
 * Replaces window.confirm(): the native dialog leaves the Electron window
 * without keyboard focus, so the composer stops accepting input until you click
 * it again. This one keeps focus inside the page. `confirmDialog(message)`
 * resolves to true/false; wire the buttons once with `initConfirm()`.
 */
import { $ } from './util.js';

let resolver = null;

function settle(val) {
  const r = resolver;
  resolver = null;
  $('#confirm-backdrop').hidden = true;
  if (r) r(val);
}

export function initConfirm() {
  $('#btn-confirm-ok').addEventListener('click', () => settle(true));
  $('#btn-confirm-cancel').addEventListener('click', () => settle(false));
  $('#confirm-backdrop').addEventListener('click', (e) => { if (e.target.id === 'confirm-backdrop') settle(false); });
  document.addEventListener('keydown', (e) => {
    if ($('#confirm-backdrop').hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); settle(false); }
    else if (e.key === 'Enter') { e.preventDefault(); settle(true); }
  });
}

/** Show the dialog; resolves true if confirmed, false otherwise. */
export function confirmDialog(message, { confirmLabel = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    if (resolver) settle(false); // clear any pending dialog first
    resolver = resolve;
    $('#confirm-message').textContent = message;
    const ok = $('#btn-confirm-ok');
    ok.textContent = confirmLabel;
    ok.className = 'btn ' + (danger ? 'btn-danger-ghost' : 'btn-primary');
    $('#confirm-backdrop').hidden = false;
    ok.focus();
  });
}
