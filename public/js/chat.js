/**
 * chat.js — conversations: the chat list, message rendering, and streaming.
 *
 * Owns everything that happens inside a chat: creating/opening/deleting
 * chats, rendering the message history (markdown for the model, escaped
 * plaintext for the user), and send() — which POSTs to /api/chat, consumes
 * Ollama's NDJSON stream chunk by chunk, re-renders markdown at most every
 * 80ms, keeps the view pinned to the bottom unless the user scrolled up,
 * and supports mid-generation Stop.
 */
import { $, esc, toast, readNdjson } from './util.js';
import { api } from './api.js';
import { state } from './state.js';
import { md } from './markdown.js';
import { skillNames, renderSkillChips } from './skills.js';
import { showView } from './views.js';
import { refreshContext, willOverflow, cannotCompact } from './context-meter.js';
import { openOverflowDialog } from './overflow.js';

const THINKING_DOTS = '<span class="thinking-dots"><i></i><i></i><i></i></span>';

/** Toggle streaming state and the send/stop button pair together. */
function setStreaming(on) {
  state.streaming = on;
  $('#btn-send').hidden = on;
  $('#btn-stop').hidden = !on;
}

export function currentChat() {
  return state.project.chats.find(c => c.id === state.chatId);
}

export function renderChatList() {
  const ul = $('#chat-list');
  ul.innerHTML = state.project.chats.map(c => `
    <li data-id="${c.id}" class="${c.id === state.chatId ? 'active' : ''}">
      <span>${esc(c.title)}</span>
      <button class="del" data-del="${c.id}" title="Delete chat">×</button>
    </li>`).join('');
  ul.querySelectorAll('li').forEach(li =>
    li.addEventListener('click', (e) => { if (!e.target.dataset.del) openChat(li.dataset.id); }));
  ul.querySelectorAll('[data-del]').forEach(b =>
    b.addEventListener('click', () => deleteChat(b.dataset.del)));
}

export async function deleteChat(cid) {
  await api(`/api/projects/${state.project.id}/chats/${cid}`, { method: 'DELETE' });
  state.project.chats = state.project.chats.filter(c => c.id !== cid);
  if (state.chatId === cid) {
    state.chatId = null;
    if (state.project.chats.length) openChat(state.project.chats[0].id); else newChat();
  } else renderChatList();
}

/** Swap a chat's rail entry for an inline input; Enter/blur saves, Esc cancels. */
export function renameChat(cid) {
  const li = document.querySelector(`#chat-list li[data-id="${cid}"]`);
  const chat = state.project.chats.find(c => c.id === cid);
  if (!li || !chat) return;
  const input = document.createElement('input');
  input.className = 'chat-rename';
  input.value = chat.title;
  li.querySelector('span').replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const commit = async () => {
    if (done) return;
    done = true;
    const title = input.value.trim();
    if (title && title !== chat.title) {
      chat.title = title;
      await api(`/api/projects/${state.project.id}/chats/${cid}`, { method: 'PUT', body: { title } });
      if (cid === state.chatId) $('#chat-title').textContent = title;
    }
    renderChatList();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commit();
    else if (e.key === 'Escape') { done = true; renderChatList(); }
    e.stopPropagation();
  });
  input.addEventListener('blur', commit);
  input.addEventListener('click', (e) => e.stopPropagation());
}

export async function newChat() {
  const chat = await api(`/api/projects/${state.project.id}/chats`, {
    method: 'POST', body: { model: $('#model-select').value },
  });
  state.project.chats.unshift(chat);
  openChat(chat.id);
}

export function openChat(cid) {
  state.chatId = cid;
  const chat = currentChat();
  showView('chat');
  $('#chat-title').textContent = chat.title;
  $('#chat-project-name').textContent = state.project.name;
  if (chat.model) {
    const opt = [...$('#model-select').options].find(o => o.value === chat.model);
    if (opt) $('#model-select').value = chat.model;
  }
  renderChatList();
  renderMessages();
  $('#input').focus();
  refreshContext();
}

export function renderMessages() {
  const chat = currentChat();
  const box = $('#messages');
  box.innerHTML = chat.messages.map(m => m.role === 'user'
    ? `<div class="msg msg-user"><div class="msg-role">You</div><div class="msg-body">${esc(m.content)}</div>${
        m.skillIds && m.skillIds.length ? `<div class="msg-skills">invoked: ${esc(skillNames(m.skillIds).join(', '))}</div>` : ''}</div>`
    : `<div class="msg msg-assistant"><div class="msg-role">${esc(m.model || 'Model')}</div><div class="msg-body">${md(m.content)}</div></div>`
  ).join('');
  box.scrollTop = box.scrollHeight;
}

export async function send(bypassOverflow = false) {
  if (state.streaming) return;
  const input = $('#input');
  const text = input.value.trim();
  if (!text || !state.project || !state.chatId) return;
  const model = $('#model-select').value;
  if (!model) { toast('No model available — is Ollama running with a pulled model?', true); return; }

  // Overflow handling: if the request won't fit the context, either the server
  // can compact it (drop old history) or — if even the system prompt alone is
  // too big — we ask the user what to do. bypassOverflow skips this after they
  // pick a remedy.
  if (!bypassOverflow && willOverflow()) {
    if (cannotCompact(text)) { openOverflowDialog(text); return; }
    toast('This chat is long — older messages will be trimmed to fit the context.');
  }

  const skillIds = [...state.invokedSkills];
  state.invokedSkills = [];
  renderSkillChips();
  input.value = '';
  input.style.height = 'auto';

  const chat = currentChat();
  chat.messages.push({ role: 'user', content: text, skillIds });
  if (chat.title === 'New chat') { chat.title = text.slice(0, 60); $('#chat-title').textContent = chat.title; renderChatList(); }
  renderMessages();

  // live assistant bubble
  const box = $('#messages');
  const bubble = document.createElement('div');
  bubble.className = 'msg msg-assistant';
  bubble.innerHTML = `<div class="msg-role">${esc(model)}</div><div class="msg-body">${THINKING_DOTS}</div>`;
  box.appendChild(bubble);
  box.scrollTop = box.scrollHeight;
  const body = bubble.querySelector('.msg-body');

  setStreaming(true);
  state.abort = new AbortController();

  let acc = '';
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: state.project.id, chatId: state.chatId, message: text, model, skillIds, options: state.project.options || {} }),
      signal: state.abort.signal,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    let lastRender = 0;
    for await (const obj of readNdjson(res)) {
      if (obj.error) throw new Error(obj.error);
      if (obj.message && obj.message.content) acc += obj.message.content;
      const now = performance.now();
      if (now - lastRender > 80) {  // throttle markdown re-render
        body.innerHTML = md(acc) || THINKING_DOTS;
        const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 160;
        if (nearBottom) box.scrollTop = box.scrollHeight;
        lastRender = now;
      }
    }
    body.innerHTML = md(acc) || '<em>(empty response)</em>';
  } catch (e) {
    if (e.name === 'AbortError') {
      body.innerHTML = md(acc) + '<p><em>— stopped —</em></p>';
    } else {
      body.innerHTML = `<p style="color:var(--blood)">⚠ ${esc(e.message)}</p>`;
    }
  }
  box.scrollTop = box.scrollHeight;
  setStreaming(false);
  chat.messages.push({ role: 'assistant', content: acc, model });
  chat.model = model;
  refreshContext(); // history grew — re-estimate the base
}
