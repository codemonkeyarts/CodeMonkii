/**
 * attachments.js — project & chat knowledge: attach, detach, and index status.
 *
 * Renders the list of attached files/folders in the inspector and the
 * per-chat attachment chips, handles attach/detach calls, and polls
 * background-indexing progress. Picking a file/folder to attach happens
 * through the generic browser in filebrowser.js — this module is just one
 * of its callers, not the browser's owner.
 */
import { $, esc, toast } from './util.js';
import { api } from './api.js';
import { state } from './state.js';
import { refreshContext } from './context-meter.js';
import { openBrowser } from './filebrowser.js';

/* Live background-index progress per attachment path, for the "indexing %"
 * badge. A big attachment starts embedding on attach; we poll until it's ready. */
const indexState = new Map();
let polling = false;

const indexBadge = (path, compact) => {
  const ix = indexState.get(path);
  if (!ix || ix.state !== 'building') return '';
  return `<span class="att-indexing" title="Building offline search index">${compact ? '' : 'indexing '}${ix.pct}%</span>`;
};

function attachedPaths() {
  const s = new Set();
  (state.project?.attachments || []).forEach(a => s.add(a.path));
  (currentChat()?.attachments || []).forEach(a => s.add(a.path));
  return [...s];
}

/** Poll index-status until nothing is building, refreshing the badges. */
export async function pollIndexing() {
  if (polling) return;
  polling = true;
  let idle = 0; // indexing starts async on the server, so wait a few rounds for it to appear
  try {
    for (;;) {
      const paths = attachedPaths();
      if (!paths.length) break;
      let data;
      try { data = await api('/api/index-status', { method: 'POST', body: { paths } }); } catch { break; }
      let building = false;
      for (const [p, s] of Object.entries(data.statuses || {})) {
        indexState.set(p, s);
        if (s.state === 'building') building = true;
      }
      if (state.project) renderAttachments();
      renderChatAttachments();
      if (building) idle = 0; else if (++idle >= 4) break; // ~5s grace before giving up
      await new Promise(r => setTimeout(r, 1200));
    }
  } finally { polling = false; }
}

export function renderAttachments() {
  const ul = $('#attachment-list');
  const atts = state.project.attachments;
  if (!atts.length) {
    ul.innerHTML = '<li class="empty">Nothing attached. Knowledge is re-read from disk on every message, so edits show up automatically.</li>';
    return;
  }
  ul.innerHTML = atts.map(a => `
    <li>
      <span class="att-icon">${a.type === 'dir' ? '▣' : '▤'}</span>
      <span class="att-path" title="${esc(a.path)}">${esc(a.path)}</span>
      ${indexBadge(a.path, false)}
      <button data-att="${a.id}" title="Detach">×</button>
    </li>`).join('');
  ul.querySelectorAll('[data-att]').forEach(b =>
    b.addEventListener('click', async () => {
      state.project = await api(`/api/projects/${state.project.id}/attachments/${b.dataset.att}`, { method: 'DELETE' });
      renderAttachments();
    }));
}

export async function attachPath(p) {
  try {
    state.project = await api(`/api/projects/${state.project.id}/attachments`, { method: 'POST', body: { path: p } });
    renderAttachments();
    pollIndexing();
    toast(`Attached: ${p}`);
  } catch (e) { toast(e.message, true); }
}

/* ---- per-chat attachments (knowledge for a single chat) ---- */

const currentChat = () => state.project?.chats.find(c => c.id === state.chatId);

/** Render the current chat's attachment chips above the composer. */
export function renderChatAttachments() {
  const wrap = $('#chat-attach-chips');
  if (!wrap) return;
  const atts = (currentChat() || {}).attachments || [];
  wrap.innerHTML = atts.map(a => `
    <span class="chat-att-chip" title="${esc(a.path)}">
      <span class="att-icon">${a.type === 'dir' ? '▣' : '▤'}</span>${esc(a.path.split(/[\\/]/).pop())}${indexBadge(a.path, true)}
      <button data-chatatt="${a.id}" title="Remove from this chat">×</button>
    </span>`).join('');
  wrap.querySelectorAll('[data-chatatt]').forEach(b =>
    b.addEventListener('click', async () => {
      const chat = await api(`/api/projects/${state.project.id}/chats/${state.chatId}/attachments/${b.dataset.chatatt}`, { method: 'DELETE' });
      syncChat(chat);
      renderChatAttachments();
      refreshContext();
    }));
}

/** Merge the server's updated chat back into local state (attachments only). */
function syncChat(chat) {
  const c = currentChat();
  if (c && chat) c.attachments = chat.attachments || [];
}

/** Attach a file/folder to the current chat via the file browser. */
export function attachToChat() {
  if (!state.project || !state.chatId) { toast('Open a chat first', true); return; }
  openBrowser({
    title: 'Add files or folders to this chat',
    verb: 'add',
    dirLabel: 'Add this folder',
    onPick: async (p) => {
      try {
        const chat = await api(`/api/projects/${state.project.id}/chats/${state.chatId}/attachments`, { method: 'POST', body: { path: p } });
        syncChat(chat);
        renderChatAttachments();
        pollIndexing();
        refreshContext();
        toast(`Added to this chat: ${p}`);
      } catch (e) { toast(e.message, true); }
    },
  });
}
