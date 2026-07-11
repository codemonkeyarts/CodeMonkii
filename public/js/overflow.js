/**
 * overflow.js — the "too long for the context" dialog.
 *
 * Shown by chat.js when a request can't be compacted to fit — i.e. the system
 * prompt and attached files alone exceed the context length, so dropping older
 * messages wouldn't help. Offers three ways forward: raise the context length
 * to the next tier that fits, start a fresh chat, or send anyway (letting the
 * model drop the oldest text). send()/newChat() arrive as callbacks from
 * main.js so this module doesn't depend on chat.js (no import cycle).
 */
import { $, toast } from './util.js';
import { api } from './api.js';
import { state } from './state.js';
import { neededContext, fmtK } from './context-meter.js';
import { initModal } from './modal.js';

let overflowText = '';
let modal;
let sendFn;
let newChatFn;

/** Populate and show the dialog for a request that overflows on `text`. */
export function openOverflowDialog(text) {
  overflowText = text;
  $('#of-msg').textContent =
    `This request needs more room than the context length (${fmtK(state.contextLimit)} tokens) allows, and it can't be trimmed by dropping older messages — the project's instructions and attached files alone fill it. Choose how to proceed:`;
  modal.open();
}

/** Wire the dialog once. `send` and `newChat` come from chat.js via main.js. */
export function initOverflowDialog(send, newChat) {
  sendFn = send;
  newChatFn = newChat;
  modal = initModal('#overflow-backdrop', '#btn-close-overflow');

  $('#btn-of-increase').addEventListener('click', async () => {
    const ctx = neededContext(overflowText);
    state.project.options = { ...(state.project.options || {}), num_ctx: ctx };
    state.contextLimit = ctx;
    await api(`/api/projects/${state.project.id}`, { method: 'PUT', body: { options: state.project.options } });
    modal.close();
    toast(`Context raised to ${fmtK(ctx)} for this project`);
    sendFn(true);
  });

  $('#btn-of-newchat').addEventListener('click', async () => {
    modal.close();
    await newChatFn();
    sendFn(true);
  });

  $('#btn-of-send').addEventListener('click', () => { modal.close(); sendFn(true); });
}
