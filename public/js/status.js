/**
 * status.js — Ollama connection status, model list, and update pill.
 *
 * Owns the sidebar health indicator (polled every 15s), the model <select>
 * population, and the "new Ollama version available" pill fed by the
 * server's daily update check.
 */
import { $, esc } from './util.js';
import { api } from './api.js';
import { state } from './state.js';
import { orFavorites } from './openrouter.js';

export async function checkHealth() {
  const el = $('#ollama-status');
  try {
    const h = await api('/api/health');
    if (h.ok) {
      el.className = 'status status-ok';
      el.querySelector('span').textContent = `Ollama ${h.version}`;
      $('#welcome-hint').hidden = true;
    } else throw new Error();
  } catch {
    el.className = 'status status-bad';
    el.querySelector('span').textContent = 'Ollama offline';
    const hint = $('#welcome-hint');
    hint.hidden = false;
    hint.textContent = state.orConfigured
      ? 'Ollama is not reachable, so local models are unavailable — remote (OpenRouter) models still work.'
      : 'Ollama is not reachable at its default address. Start it with "ollama serve" (or launch the Ollama app), then this light turns green.';
  }
}

/** "☁ remote" chip beside the picker — visible when the selected model runs
 * off-machine, so it's always obvious where a chat's text goes. */
export function updateRemoteBadge() {
  $('#remote-badge').hidden = !($('#model-select').value || '').startsWith('openrouter:');
}

export async function loadModels() {
  const sel = $('#model-select');
  const prev = sel.value;
  let local = [];
  let ollamaUp = true;
  try {
    local = (await api('/api/models')).models;
  } catch { ollamaUp = false; }
  state.models = local;

  const favs = state.orConfigured ? orFavorites() : [];
  if (!local.length && !favs.length) {
    sel.innerHTML = ollamaUp
      ? '<option value="">no models — try: ollama pull llama3.2</option>'
      : '<option value="">Ollama offline</option>';
  } else {
    const localOpts = local.map(m => `<option value="${esc(m.name)}">${esc(m.name)}</option>`).join('');
    const remoteOpts = favs.map(f => `<option value="openrouter:${esc(f.id)}">☁ ${esc(f.name || f.id)}</option>`).join('');
    sel.innerHTML =
      (local.length ? `<optgroup label="On this machine">${localOpts}</optgroup>` : '') +
      (favs.length ? `<optgroup label="OpenRouter — remote">${remoteOpts}</optgroup>` : '');
    if (prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;
  }
  updateRemoteBadge();
}

let updatePrompted = false; // one native popup per session

export async function checkOllamaUpdate() {
  try {
    const u = await api('/api/update-check');
    const pill = $('#ollama-update');
    if (u.updateAvailable) {
      pill.textContent = `↑ Ollama ${u.latest} available`;
      pill.title = `You have ${u.current}. Click to download ${u.latest}.`;
      if (u.url) pill.href = u.url;
      pill.hidden = false;
      // In the desktop app, nudge with a native popup (the pill alone is easy to
      // miss). Once per session here; the main process also mutes any version
      // the user asked not to be reminded about.
      if (!updatePrompted && window.monkii?.ollamaUpdatePrompt) {
        updatePrompted = true;
        window.monkii.ollamaUpdatePrompt({ current: u.current, latest: u.latest, url: u.url });
      }
    } else pill.hidden = true;
  } catch { /* non-essential */ }
}
