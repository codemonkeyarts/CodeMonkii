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
}

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

export function initPrefs() {
  if (!bridge) return; // browser mode — no desktop shell to configure

  const modal = initModal('#prefs-backdrop', '#btn-close-prefs');
  $('#btn-prefs').hidden = false;
  $('#btn-prefs').addEventListener('click', async () => {
    render(await bridge.getPrefs());
    modal.open();
  });

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
}
