/**
 * attachments.js — project knowledge panel and the file-browser modal.
 *
 * Renders the list of attached files/folders in the inspector, handles
 * attach/detach calls, and drives the modal directory browser (navigate,
 * drill into folders, attach a file or the whole current folder).
 */
import { $, esc, toast } from './util.js';
import { api } from './api.js';
import { state } from './state.js';
import { refreshContext } from './context-meter.js';

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
      if (!building) break;
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

/* ---- file browser modal ----
 * By default picking a file/folder attaches it to the current project, but
 * openBrowser accepts a different onPick handler (e.g. importing a skill
 * folder) along with the title and verb to show. The mode resets on every
 * open, so a skill import never leaks into a later knowledge attach. */

let pick = attachPath;
let pickVerb = 'attach';

export async function openBrowser(opts = {}) {
  pick = opts.onPick || attachPath;
  pickVerb = opts.verb || 'attach';
  $('#file-browser h3').textContent = opts.title || 'Attach from this machine';
  $('#btn-attach-dir').textContent = opts.dirLabel || 'Attach this folder';
  $('#modal-backdrop').hidden = false;
  await browseTo(state.fbDir || undefined);
}

/** Hand the currently open directory to the active pick handler. */
export function pickCurrentDir() {
  if (state.fbDir && state.fbDir !== '__drives__') { pick(state.fbDir); closeBrowser(); }
}

export async function browseTo(dir) {
  try {
    const data = await api('/api/fs' + (dir ? `?dir=${encodeURIComponent(dir)}` : ''));
    state.fbDir = data.dir;
    $('#fb-path').textContent = data.dir === '__drives__' ? 'This PC' : data.dir;
    $('#btn-attach-dir').style.visibility = data.dir === '__drives__' ? 'hidden' : 'visible';
    const up = data.dir !== '__drives__' && data.parent !== data.dir
      ? `<li data-dir="${esc(data.parent)}"><span class="fb-icon">↰</span><span>..</span></li>` : '';
    $('#fb-entries').innerHTML = up + data.entries.map(e => e.isDir
      ? `<li data-dir="${esc(e.path)}"><span class="fb-icon">▣</span><span>${esc(e.name)}</span><button class="fb-attach" data-attach="${esc(e.path)}">${esc(pickVerb)}</button></li>`
      : `<li class="fb-file" data-file="${esc(e.path)}"><span class="fb-icon">▤</span><span>${esc(e.name)}</span><button class="fb-attach" data-attach="${esc(e.path)}">${esc(pickVerb)}</button></li>`
    ).join('');
    $('#fb-entries').querySelectorAll('li[data-dir]').forEach(li =>
      li.addEventListener('click', (e) => { if (!e.target.dataset.attach) browseTo(li.dataset.dir); }));
    $('#fb-entries').querySelectorAll('li[data-file]').forEach(li =>
      li.addEventListener('click', (e) => { if (!e.target.dataset.attach) { pick(li.dataset.file); closeBrowser(); } }));
    $('#fb-entries').querySelectorAll('[data-attach]').forEach(b =>
      b.addEventListener('click', () => { pick(b.dataset.attach); closeBrowser(); }));
  } catch (e) { toast(e.message, true); }
}

export function closeBrowser() { $('#modal-backdrop').hidden = true; }
