/**
 * prefs.js — in-app Preferences panel (desktop shell only).
 *
 * The Electron preload exposes `window.monkii`; when present, the gear in
 * the rail footer opens a modal with three storage locations:
 *   - Ollama models folder (applies next time the shell starts Ollama)
 *   - projects & chats folder (server restarts + UI reloads on change)
 *   - skills folder          (server restarts + UI reloads on change)
 * Each can be overridden by its env var, in which case it renders read-only.
 * In plain browser mode the global is absent and the gear stays hidden.
 */
import { $, esc, toast } from './util.js';
import { api } from './api.js';
import { initModal } from './modal.js';

const bridge = window.monkii;

function renderLocation(pathElId, noteElId, buttonIds, value, envValue) {
  $(pathElId).textContent = envValue || value;
  $(noteElId).hidden = !envValue;
  for (const id of buttonIds) $(id).disabled = Boolean(envValue);
}

function render(prefs) {
  const modelsLabel = (!prefs.modelsDir || prefs.modelsDir === 'default')
    ? 'Ollama default (~/.ollama/models)'
    : prefs.modelsDir;
  renderLocation('#prefs-models-dir', '#prefs-env-note',
    ['#btn-prefs-choose-dir', '#btn-prefs-default-dir'],
    modelsLabel, prefs.envOverride);

  renderLocation('#prefs-data-dir', '#prefs-data-env-note',
    ['#btn-prefs-choose-data', '#btn-prefs-default-data'],
    prefs.dataDir + (prefs.dataDirCustom ? '' : '  (default)'), prefs.dataDirEnv);

  renderLocation('#prefs-skills-dir', '#prefs-skills-env-note',
    ['#btn-prefs-choose-skills', '#btn-prefs-default-skills'],
    prefs.skillsDir + (prefs.skillsDirCustom ? '' : '  (default)'), prefs.skillsDirEnv);

  renderFsAccess(prefs);

  const upEnv = prefs.updateCheckEnv;
  $('#prefs-update-check').checked = prefs.updateCheck;
  $('#prefs-update-check').disabled = Boolean(upEnv);
  $('#prefs-update-env-note').hidden = !upEnv;

  renderOpenRouter(prefs);
}

/** OpenRouter key status: the key is write-only, so all we render is whether
 * one exists and where it came from — plus a live credits readout. */
function renderOpenRouter(prefs) {
  $('#prefs-or-status').textContent = prefs.openrouterConfigured
    ? 'Key saved — remote models are available in the model picker.'
    : 'No key — Monkii is fully local.';
  $('#prefs-or-env-note').hidden = !prefs.openrouterKeyEnv;
  for (const id of ['#prefs-or-key', '#btn-prefs-or-save', '#btn-prefs-or-clear'])
    $(id).disabled = Boolean(prefs.openrouterKeyEnv);
  $('#btn-prefs-or-clear').hidden = !prefs.openrouterConfigured || prefs.openrouterKeyEnv;

  // privacy routing toggle (checked = allow logging providers)
  $('#prefs-or-logging').checked = prefs.orDataCollection === 'allow';
  $('#prefs-or-logging').disabled = Boolean(prefs.orDataCollectionEnv);
  $('#prefs-or-logging-env-note').hidden = !prefs.orDataCollectionEnv;

  // live spend on the key, filled in once the (async) check returns. The
  // generation counter keeps a slow response from a previous open from
  // appending to (or duplicating on) a newer render.
  if (prefs.openrouterConfigured) {
    const base = $('#prefs-or-status').textContent;
    const gen = ++keyStatusGen;
    api('/api/openrouter/key-status').then(k => {
      if (gen !== keyStatusGen) return; // a newer render superseded this fetch
      const spent = k.usage != null ? `$${k.usage.toFixed(2)} used` : '';
      const cap = k.limit != null ? ` of $${k.limit.toFixed(2)}` : '';
      const tier = k.isFreeTier ? ' (free tier)' : '';
      if (spent) $('#prefs-or-status').textContent = `${base} · ${spent}${cap}${tier}`;
    }).catch(() => { /* offline — the static line stands */ });
  }
}
let keyStatusGen = 0;

/** The file-access allowlist: whole-disk banner, or a removable list of folders. */
function renderFsAccess(prefs) {
  const env = prefs.fsRootsEnv;
  $('#prefs-fs-env-note').hidden = !env;
  for (const id of ['#btn-prefs-fs-add', '#btn-prefs-fs-all', '#btn-prefs-fs-home']) $(id).disabled = Boolean(env);

  const summary = $('#prefs-fs-summary');
  const list = $('#prefs-fs-list');
  if (prefs.fsWholeDisk) {
    summary.textContent = 'Whole disk — Monkii can read anywhere on this computer.';
    list.innerHTML = '';
    return;
  }
  const roots = prefs.fsRoots || [];
  summary.textContent = (roots.length === 1 && roots[0] === prefs.fsHome)
    ? 'Your home folder only (default)'
    : `${roots.length} allowed folder${roots.length === 1 ? '' : 's'}`;
  list.innerHTML = roots.map(r => `
    <li><span class="att-path" title="${esc(r)}">${esc(r)}</span>${
      env ? '' : `<button data-fsroot="${encodeURIComponent(r)}" title="Remove">×</button>`}</li>`).join('');
  if (!env) list.querySelectorAll('[data-fsroot]').forEach(b =>
    b.addEventListener('click', async () => {
      const next = await bridge.removeFsRoot(decodeURIComponent(b.dataset.fsroot));
      if (next) render(next);
    }));
}

/* Data/skills changes restart the server and reload the page, so the toast
 * only shows if the call returns without a reload (cancel or env-locked). */
function wireAction(btnId, call, msg) {
  $(btnId).addEventListener('click', async () => {
    const prefs = await call();
    if (!prefs) return; // picker canceled
    render(prefs);
    if (msg) toast(msg);
  });
}

/* ---- theme (works in desktop AND browser mode — purely client-side) ---- */

const THEME_KEY = 'monkii.theme'; // keep in sync with js/theme-boot.js
const savedTheme = () => { try { return localStorage.getItem(THEME_KEY) || 'cyber-deco'; } catch { return 'cyber-deco'; } };

function applyTheme(t) {
  if (t && t !== 'cyber-deco') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  try { localStorage.setItem(THEME_KEY, t); } catch { /* storage disabled */ }
}

export function initPrefs() {
  const modal = initModal('#prefs-backdrop', '#btn-close-prefs');
  $('#btn-prefs').hidden = false;

  const themeSel = $('#prefs-theme');
  themeSel.value = savedTheme();
  themeSel.addEventListener('change', () => applyTheme(themeSel.value));

  $('#btn-prefs').addEventListener('click', async () => {
    themeSel.value = savedTheme();
    if (bridge) render(await bridge.getPrefs());
    modal.open();
  });

  if (!bridge) {
    // browser mode: no desktop shell to configure — only the theme applies
    document.querySelectorAll('#prefs-backdrop .prefs-desktop').forEach(el => { el.hidden = true; });
    return;
  }

  wireAction('#btn-prefs-choose-dir', () => bridge.chooseModelsDir(),
    'Models folder saved — applies next time Monkii starts Ollama');
  wireAction('#btn-prefs-default-dir', () => bridge.setModelsDefault(),
    'Using Ollama default — applies next time Monkii starts Ollama');

  wireAction('#btn-prefs-choose-data', () => bridge.chooseDataDir());
  wireAction('#btn-prefs-default-data', () => bridge.resetDataDir());
  wireAction('#btn-prefs-choose-skills', () => bridge.chooseSkillsDir());
  wireAction('#btn-prefs-default-skills', () => bridge.resetSkillsDir());

  wireAction('#btn-prefs-fs-add', () => bridge.addFsRoot());
  wireAction('#btn-prefs-fs-all', () => bridge.fsWholeDisk());
  wireAction('#btn-prefs-fs-home', () => bridge.fsResetHome());

  // toggling restarts the server (config reads the flag at boot) and reloads
  $('#prefs-update-check').addEventListener('change', (e) => bridge.setUpdateCheck(e.target.checked));

  // OpenRouter key: sent one-way to the main process (encrypted at rest),
  // input cleared immediately either way
  $('#btn-prefs-or-save').addEventListener('click', async () => {
    const key = $('#prefs-or-key').value.trim();
    if (!key) { toast('Paste an OpenRouter API key first', true); return; }
    $('#prefs-or-key').value = '';
    try {
      const prefs = await bridge.setOpenRouterKey(key);
      if (prefs) { render(prefs); toast('OpenRouter key saved'); }
    } catch { toast('Could not save the key (OS encryption unavailable)', true); }
  });
  $('#btn-prefs-or-clear').addEventListener('click', async () => {
    const prefs = await bridge.setOpenRouterKey('');
    if (prefs) { render(prefs); toast('OpenRouter key removed — fully local again'); }
  });

  // privacy routing: restarts the server (config reads the flag at boot)
  $('#prefs-or-logging').addEventListener('change', (e) => bridge.setOrLogging(e.target.checked));
}
