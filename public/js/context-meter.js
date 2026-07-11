/**
 * context-meter.js — live token/context awareness in the composer.
 *
 * Shows an estimated "~tokens / limit" readout that turns amber as a request
 * approaches the context length set in Model settings, and red once it would
 * overflow. The fixed part (system prompt + history) is estimated server-side
 * via /api/context — refreshed when the chat opens, after each send, and when
 * the invoked-skill set changes — and cached; the message being typed is
 * added live on the client. Estimates are rough (~4 chars/token), enough to
 * warn before the model silently drops earlier messages or stalls.
 */
import { $ } from './util.js';
import { api } from './api.js';
import { state } from './state.js';

const estimate = (text) => Math.ceil((text || '').length / 4);
const fmt = (n) => n.toLocaleString();

/** Re-estimate the fixed cost of the current chat and repaint the meter. */
export async function refreshContext() {
  const meter = $('#context-meter');
  if (!state.project || !state.chatId) { meter.textContent = ''; return; }
  try {
    const { baseTokens, limit } = await api('/api/context', {
      method: 'POST',
      body: { projectId: state.project.id, chatId: state.chatId, skillIds: state.invokedSkills },
    });
    state.baseTokens = baseTokens;
    state.contextLimit = limit;
  } catch { state.baseTokens = null; }
  updateMeter();
}

/** Repaint using the cached base plus whatever is currently typed. */
export function updateMeter() {
  const meter = $('#context-meter');
  if (state.baseTokens == null || !state.chatId) { meter.textContent = ''; return; }
  const total = state.baseTokens + estimate($('#input').value);
  const limit = state.contextLimit;
  const ratio = total / limit;
  meter.textContent = `~${fmt(total)} / ${fmt(limit)} tokens`;
  meter.className = ratio > 1 ? 'over' : ratio > 0.8 ? 'near' : '';
  if (ratio > 1) meter.textContent = `⚠ ~${fmt(total)} / ${fmt(limit)} — over context`;
}

/** True if the current request is estimated to overflow the context length. */
export function willOverflow() {
  if (state.baseTokens == null) return false;
  return state.baseTokens + estimate($('#input').value) > state.contextLimit;
}
