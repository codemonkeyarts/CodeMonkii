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
import { $, toast } from './util.js';
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
}
