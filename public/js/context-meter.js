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

/** Token count as a compact "16k" / "512" label. */
// context-length formatting lives in util.js; re-exported under the name the
// meter's consumers (overflow, model-settings) historically import
export { fmtCtx as fmtK } from './util.js';

/** Blank the meter immediately — used when switching chats so the previous
 *  chat's count doesn't linger while the new estimate loads. */
export function clearContext() {
  state.baseTokens = null;
  updateMeter();
}

/** Re-estimate the fixed cost of the current chat and repaint the meter.
 *  Guarded against races: if a different chat is opened while the request is
 *  in flight, its (now stale) result is dropped rather than clobbering the
 *  newer chat's count. */
export async function refreshContext() {
  if (!state.project || !state.chatId) { clearContext(); return; }
  const forChat = state.chatId;
  try {
    const { baseTokens, systemTokens, limit } = await api('/api/context', {
      method: 'POST',
      body: { projectId: state.project.id, chatId: forChat, skillIds: state.invokedSkills },
    });
    if (state.chatId !== forChat) return; // a newer chat opened — drop this result
    state.baseTokens = baseTokens;
    state.systemTokens = systemTokens || 0;
    state.contextLimit = limit;
  } catch {
    if (state.chatId === forChat) state.baseTokens = null;
  }
  if (state.chatId === forChat) updateMeter();
}

/** Would this request still overflow even with all history dropped? Then
 *  compaction can't help — the system prompt/attachments alone are too big. */
export function cannotCompact(inputText) {
  if (state.baseTokens == null) return false;
  return state.systemTokens + estimate(inputText) > state.contextLimit;
}

/** Smallest power-of-two num_ctx (capped at 256k) that fits this request. */
export function neededContext(inputText) {
  const need = state.systemTokens + estimate(inputText) + 512; // headroom for the reply
  let ctx = 4096;
  while (ctx < need && ctx < 262144) ctx *= 2;
  return ctx;
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
