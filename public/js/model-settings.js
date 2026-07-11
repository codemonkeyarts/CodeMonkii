/**
 * model-settings.js — per-project Ollama generation options.
 *
 * A modal (opened from the gear beside the model picker) edits the options
 * applied to every chat in the current project: model, context length, and
 * temperature up top, the rest under a collapsible "Advanced settings".
 * Values persist on the project (PUT /api/projects/:id) and ride along with
 * each /api/chat request via chat.js. Empty advanced fields are omitted so
 * the model's own default applies; the server sanitizes everything again.
 */
import { $, esc, toast } from './util.js';
import { api } from './api.js';
import { state } from './state.js';
import { updateModelInfo } from './model-info.js';
import { fmtK } from './context-meter.js';

/* Advanced params: [key, label, description, placeholder]. Order matches the
 * Ollama docs the screenshots came from. num_ctx/temperature live in the
 * always-visible section, so they are not repeated here. */
const ADVANCED = [
  ['num_predict', 'Max tokens', 'Maximum number of tokens to generate. Empty = model default.', '4096'],
  ['mirostat', 'mirostat', 'Mirostat sampling for perplexity control (0 = off, 1 = v1, 2 = v2).', '0'],
  ['mirostat_eta', 'mirostat_eta', 'How quickly Mirostat responds to feedback. (Default 0.1)', '0.10'],
  ['mirostat_tau', 'mirostat_tau', 'Balance of coherence vs diversity. (Default 5.0)', '5.00'],
  ['num_gqa', 'num_gqa', 'GQA groups in the transformer. Required for some models (e.g. 8 for llama2:70b).', '0'],
  ['num_thread', 'num_thread', 'CPU threads to use. Default auto-detects physical cores.', '0'],
  ['repeat_last_n', 'repeat_last_n', 'How far back to look to prevent repetition. (Default 64, 0 = off, -1 = num_ctx)', '64'],
  ['repeat_penalty', 'repeat_penalty', 'How strongly to penalize repetition. (Default 1.1)', '1.10'],
  ['seed', 'seed', 'Random seed. A fixed value makes generation reproducible.', '0'],
  ['tfs_z', 'tfs_z', 'Tail-free sampling; higher reduces low-probability tokens. (1 = off)', '1.00'],
  ['top_k', 'top_k', 'Limits token choices; lower is more conservative. (Default 40)', '40'],
  ['top_p', 'top_p', 'Nucleus sampling; lower is more focused. (Default 0.9)', '0.90'],
  ['min_p', 'min_p', 'Minimum token probability relative to the most likely. (Default 0.0)', '0.00'],
  ['stop', 'stop', 'Stop sequences, comma-separated. Generation halts when one is produced.', 'stop, \\n, user:'],
  ['keep_alive', 'keep_alive', 'How long the model stays loaded (e.g. 5m, 30, -1 for forever, 0 to unload now).', '5m'],
];

const ctxLabel = (pow) => fmtK(2 ** pow);

function renderAdvanced() {
  $('#ms-advanced-fields').innerHTML = ADVANCED.map(([key, label, desc, ph]) => `
    <label class="ms-adv-field">
      <span class="ms-adv-name">${esc(label)}</span>
      <span class="ms-adv-desc">${esc(desc)}</span>
      <input data-opt="${esc(key)}" type="text" placeholder="${esc(ph)}">
    </label>`).join('');
}

/** Populate the model dropdown; mirrors the chat-header select. */
function fillModels() {
  const header = $('#model-select');
  $('#ms-model').innerHTML = header.innerHTML;
  $('#ms-model').value = header.value;
}

/** Load the current project's saved options into the controls. */
function load() {
  fillModels();
  updateModelInfo($('#ms-model').value);
  const o = state.project?.options || {};

  const pow = o.num_ctx ? Math.round(Math.log2(o.num_ctx)) : 12;
  const clamped = Math.min(18, Math.max(12, pow));
  $('#ms-num_ctx').value = clamped;
  $('#ms-ctx-out').textContent = ctxLabel(clamped);

  const temp = o.temperature != null ? o.temperature : 1;
  $('#ms-temperature').value = temp;
  $('#ms-temp-out').textContent = Number(temp).toFixed(2);

  for (const [key] of ADVANCED) {
    const el = $(`#ms-advanced-fields [data-opt="${key}"]`);
    if (el) el.value = o[key] != null ? o[key] : '';
  }
}

/** Collect the controls into an options object (empties omitted). */
function collect() {
  const o = {
    num_ctx: 2 ** Number($('#ms-num_ctx').value),
    temperature: Number($('#ms-temperature').value),
  };
  for (const [key] of ADVANCED) {
    const v = $(`#ms-advanced-fields [data-opt="${key}"]`).value.trim();
    if (v !== '') o[key] = v;
  }
  return o;
}

async function save() {
  if (!state.project) return;
  const options = collect();
  state.project.options = options;
  try {
    await api(`/api/projects/${state.project.id}`, { method: 'PUT', body: { options } });
  } catch (e) { toast(e.message, true); }
}

export function initModelSettings(openModal) {
  renderAdvanced();

  $('#btn-model-settings').addEventListener('click', () => { load(); openModal(); });

  // model choice is shared with the header select, both directions
  $('#ms-model').addEventListener('change', () => {
    $('#model-select').value = $('#ms-model').value;
    $('#model-select').dispatchEvent(new Event('change'));
    updateModelInfo($('#ms-model').value);
  });

  $('#ms-num_ctx').addEventListener('input', () => {
    $('#ms-ctx-out').textContent = ctxLabel(Number($('#ms-num_ctx').value));
  });
  $('#ms-temperature').addEventListener('input', () => {
    $('#ms-temp-out').textContent = Number($('#ms-temperature').value).toFixed(2);
  });

  // persist on any change (sliders on release, text fields on blur/enter)
  const panel = $('#model-settings-panel');
  panel.addEventListener('change', save);
}
