/**
 * search.js — search across every project, chat, and message.
 *
 * A debounced query against GET /api/search; results are grouped visually
 * by type (project / chat / message) with a snippet for message hits.
 * Clicking a result opens the right project and chat, and for a message hit
 * scrolls to and briefly flashes the exact bubble.
 */
import { $, esc } from './util.js';
import { api } from './api.js';
import { openProject } from './projects.js';
import { openChat, scrollToMessage } from './chat.js';
import { initModal } from './modal.js';

let modal;
let debounceTimer;
let searchGen = 0; // bumped per query; a stale async response is dropped if it doesn't match
let activeIdx = -1;

/** Escape `text`, wrapping the first case-insensitive match of `q` in <mark>. */
function highlight(text, q) {
  const at = text.toLowerCase().indexOf(q.toLowerCase());
  if (at === -1) return esc(text);
  return esc(text.slice(0, at)) + '<mark>' + esc(text.slice(at, at + q.length)) + '</mark>' + esc(text.slice(at + q.length));
}

function resultRow(r, q) {
  if (r.type === 'project') {
    return `<li data-project="${esc(r.projectId)}"><span class="search-kind">project</span><span class="search-title">${highlight(r.projectName, q)}</span></li>`;
  }
  if (r.type === 'chat') {
    return `<li data-project="${esc(r.projectId)}" data-chat="${esc(r.chatId)}"><span class="search-kind">chat</span><span class="search-title">${highlight(r.chatTitle, q)}</span><span class="search-crumb">${esc(r.projectName)}</span></li>`;
  }
  return `<li data-project="${esc(r.projectId)}" data-chat="${esc(r.chatId)}" data-idx="${r.messageIdx}">
    <span class="search-kind">${r.role === 'user' ? 'you' : 'reply'}</span>
    <span class="search-snippet">${highlight(r.snippet, q)}</span>
    <span class="search-crumb">${esc(r.projectName)} › ${esc(r.chatTitle)}</span>
  </li>`;
}

function resultEls() { return [...$('#search-results').querySelectorAll('li[data-project]')]; }

/** Highlight result `i` (wrapping) as the keyboard-active row. */
function setActive(i) {
  const els = resultEls();
  activeIdx = els.length ? ((i % els.length) + els.length) % els.length : -1;
  els.forEach((li, idx) => li.classList.toggle('search-active', idx === activeIdx));
  if (activeIdx !== -1) els[activeIdx].scrollIntoView({ block: 'nearest' });
}

async function runSearch(q) {
  const list = $('#search-results');
  activeIdx = -1;
  if (q.trim().length < 2) { searchGen++; list.innerHTML = ''; return; } // also bump gen: drops any in-flight stale fetch
  list.innerHTML = '<li class="search-empty">Searching…</li>';
  const gen = ++searchGen;
  let data;
  try { data = await api(`/api/search?q=${encodeURIComponent(q)}`); }
  catch { if (gen === searchGen) list.innerHTML = '<li class="search-empty">Search failed.</li>'; return; }
  if (gen !== searchGen) return; // a newer query started since this one fired; drop the stale response
  list.innerHTML = data.results.length
    ? data.results.map(r => resultRow(r, q)).join('')
    : '<li class="search-empty">No matches.</li>';
  list.querySelectorAll('li[data-project]').forEach(li => li.addEventListener('click', () => openResult(li)));
  if (data.results.length) setActive(0);
}

async function openResult(li) {
  const { project, chat, idx } = li.dataset;
  closeSearch();
  await openProject(project);
  if (chat) openChat(chat); // openProject already lands on a chat; this switches to the matched one if different
  if (idx !== undefined) scrollToMessage(Number(idx));
}

export function openSearch() {
  modal.open();
  $('#search-input').value = '';
  $('#search-results').innerHTML = '';
  $('#search-input').focus();
}

export function closeSearch() { modal.close(); }

export function initSearch() {
  modal = initModal('#search-backdrop', '#btn-close-search');
  $('#search-input').addEventListener('input', (e) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => runSearch(e.target.value), 200);
  });
  $('#search-input').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeSearch(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(activeIdx + 1); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive(activeIdx - 1); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      const els = resultEls();
      if (activeIdx !== -1 && els[activeIdx]) openResult(els[activeIdx]);
    }
  });
}
