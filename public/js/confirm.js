/**
 * confirm.js — a small in-app confirmation dialog.
 *
 * Replaces window.confirm(): the native dialog leaves the Electron window
 * without keyboard focus, so the composer stops accepting input until you click
 * it again. This one keeps focus inside the page. `confirmDialog(message)`
 * resolves to true/false; wire the buttons once with `initConfirm()`.
 *
 * `requireText` raises the bar for the most destructive actions (wiping all
 * data): the OK button stays disabled, and Enter does nothing, until the
 * typed value matches exactly — the same friction GitHub uses for "delete
 * this repo," reserved here for the one action that's just as final.
 */
import { $ } from './util.js';

let resolver = null;
let requireText = null;

function settle(val) {
  const r = resolver;
  resolver = null;
  requireText = null;
  $('#confirm-backdrop').hidden = true;
  $('#confirm-typed-field').hidden = true;
  $('#confirm-typed').value = '';
  if (r) r(val);
}

function canConfirm() {
  return requireText == null || $('#confirm-typed').value === requireText;
}

function syncOkEnabled() {
  $('#btn-confirm-ok').disabled = !canConfirm();
}

export function initConfirm() {
  $('#btn-confirm-ok').addEventListener('click', () => { if (canConfirm()) settle(true); });
  $('#btn-confirm-cancel').addEventListener('click', () => settle(false));
  $('#confirm-backdrop').addEventListener('click', (e) => { if (e.target.id === 'confirm-backdrop') settle(false); });
  $('#confirm-typed').addEventListener('input', syncOkEnabled);
  document.addEventListener('keydown', (e) => {
    if ($('#confirm-backdrop').hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); settle(false); }
    else if (e.key === 'Enter' && canConfirm()) { e.preventDefault(); settle(true); }
  });
}

/** Show the dialog; resolves true if confirmed, false otherwise.
 *  `requireText`: if set, OK stays disabled until the user types this exact
 *  string into an inline field (for the most destructive actions only). */
export function confirmDialog(message, { confirmLabel = 'Confirm', danger = false, requireText: need = null } = {}) {
  return new Promise((resolve) => {
    if (resolver) settle(false); // clear any pending dialog first
    resolver = resolve;
    requireText = need;
    $('#confirm-message').textContent = message;
    const ok = $('#btn-confirm-ok');
    ok.textContent = confirmLabel;
    ok.className = 'btn ' + (danger ? 'btn-danger-ghost' : 'btn-primary');
    const field = $('#confirm-typed-field');
    field.hidden = !need;
    if (need) $('#confirm-typed-label').textContent = `Type "${need}" to confirm`;
    syncOkEnabled();
    $('#confirm-backdrop').hidden = false;
    (need ? $('#confirm-typed') : ok).focus();
  });
}
