/**
 * openrouter.js — remote-model UI: the browse/favorites dialog.
 *
 * All remote UI stays hidden until the server reports an API key is
 * configured (the key itself never reaches the browser). The dialog lists
 * OpenRouter's catalog with context length and $/M-token pricing; starring
 * a model adds it to the header picker as "openrouter:<id>". Favorites are
 * stored locally as {id, name, contextLength} so the picker renders them
 * without needing the catalog fetched first.
 */
import { $, esc, fmtCtx } from './util.js';
import { api } from './api.js';
import { state } from './state.js';
import { initModal } from './modal.js';
import { loadModels } from './status.js';

/* Single source of truth for the remote-model namespace on the frontend
 * (mirrors PREFIX in lib/openrouter.js — the chat.model values on disk). */
export const OR_PREFIX = 'openrouter:';
export const isRemoteModel = (name) => typeof name === 'string' && name.startsWith(OR_PREFIX);

const FAV_KEY = 'monkii.orFavorites';

export function orFavorites() {
  try { return JSON.parse(localStorage.getItem(FAV_KEY)) || []; } catch { return []; }
}
const saveFavorites = (f) => localStorage.setItem(FAV_KEY, JSON.stringify(f));

/** Ask the server whether a key exists; toggles all remote UI. */
export async function refreshOrStatus() {
  try { state.orConfigured = (await api('/api/openrouter/status')).configured; }
  catch { state.orConfigured = false; }
  $('#btn-or-browse').hidden = !state.orConfigured;
  return state.orConfigured;
}

/* ---- browse dialog ---- */

const perM = (p) => (p == null || Number.isNaN(p)) ? '—' : `$${(p * 1e6).toFixed(2)}`;

function renderList() {
  const q = $('#or-search').value.trim().toLowerCase();
  const freeOnly = $('#or-free-only').checked;
  const favs = orFavorites();
  const isFav = (id) => favs.some(f => f.id === id);
  const rows = (state.orCatalog || [])
    .filter(m => !q || m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
    .filter(m => !freeOnly || (m.promptPrice === 0 && m.completionPrice === 0))
    .sort((a, b) => (isFav(b.id) - isFav(a.id)) || a.id.localeCompare(b.id))
    .slice(0, 250);

  $('#or-list').innerHTML = rows.length ? rows.map(m => `
    <li>
      <button class="or-star ${isFav(m.id) ? 'faved' : ''}" data-id="${esc(m.id)}"
        title="${isFav(m.id) ? 'Remove from your model picker' : 'Add to your model picker'}">${isFav(m.id) ? '★' : '☆'}</button>
      <div class="or-meta">
        <div class="or-name">${esc(m.name)}</div>
        <div class="or-id">${esc(m.id)}</div>
      </div>
      <div class="or-specs">${fmtCtx(m.contextLength, '—')} ctx · ${perM(m.promptPrice)} in / ${perM(m.completionPrice)} out <span class="or-perm">per M tokens</span></div>
    </li>`).join('')
    : '<li class="empty">No models match.</li>';

  $('#or-list').querySelectorAll('.or-star').forEach(b => b.addEventListener('click', () => toggleFav(b.dataset.id)));
}

function toggleFav(id) {
  const favs = orFavorites();
  const i = favs.findIndex(f => f.id === id);
  if (i >= 0) favs.splice(i, 1);
  else {
    const m = (state.orCatalog || []).find(x => x.id === id) || {};
    // keep enough metadata (incl. prices) for the picker and info box to
    // render without needing the catalog fetched first
    favs.push({
      id, name: m.name || id, contextLength: m.contextLength || null,
      promptPrice: m.promptPrice ?? null, completionPrice: m.completionPrice ?? null,
    });
  }
  saveFavorites(favs);
  renderList();
  loadModels(); // picker reflects stars immediately
}

async function loadCatalog() {
  const list = $('#or-list');
  if (!state.orCatalog) {
    list.innerHTML = '<li class="empty">Loading the OpenRouter catalog…</li>';
    try { state.orCatalog = (await api('/api/openrouter/models')).models; }
    catch (e) { list.innerHTML = `<li class="empty">${esc(e.message)}</li>`; return; }
  }
  renderList();
}

export function initOpenRouter() {
  initModal('#or-backdrop', '#btn-close-or');
  $('#btn-or-browse').addEventListener('click', () => { $('#or-backdrop').hidden = false; $('#or-search').focus(); loadCatalog(); });
  $('#or-search').addEventListener('input', renderList);
  $('#or-free-only').addEventListener('change', renderList);
}
