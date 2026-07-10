/**
 * main.js — entry point: event wiring and startup.
 *
 * Imports every feature module, binds all buttons/keyboard handlers exactly
 * once, then boots: check Ollama health, load models and skills, list
 * projects, and reopen the most recent one. Also schedules the recurring
 * health poll (15s) and update check (6h — the server caches for 24h).
 */
import { $, autoGrow } from './util.js';
import { state } from './state.js';
import { checkHealth, loadModels, checkOllamaUpdate } from './status.js';
import { loadSkills, updateSkillPopup, pickSkill } from './skills.js';
import { createProject, openProject, saveProjectMeta, deleteProject, refreshProjects } from './projects.js';
import { openBrowser, browseTo, closeBrowser, attachPath } from './attachments.js';
import { newChat, send } from './chat.js';
import { initPrefs } from './prefs.js';

function wire() {
  initPrefs();
  $('#btn-new-project').addEventListener('click', createProject);
  $('#btn-welcome-project').addEventListener('click', createProject);
  $('#btn-new-chat').addEventListener('click', newChat);
  $('#btn-send').addEventListener('click', send);
  $('#btn-stop').addEventListener('click', () => state.abort && state.abort.abort());

  $('#btn-toggle-inspector').addEventListener('click', () => {
    $('#inspector').hidden = !$('#inspector').hidden;
  });
  $('#btn-close-inspector').addEventListener('click', () => { $('#inspector').hidden = true; });
  $('#proj-name').addEventListener('change', saveProjectMeta);
  $('#proj-instructions').addEventListener('change', saveProjectMeta);
  $('#btn-delete-project').addEventListener('click', deleteProject);

  $('#btn-browse').addEventListener('click', () => openBrowser());
  $('#btn-close-browser').addEventListener('click', closeBrowser);
  $('#btn-fb-drives').addEventListener('click', () => browseTo('__drives__'));
  $('#btn-attach-dir').addEventListener('click', () => {
    if (state.fbDir && state.fbDir !== '__drives__') { attachPath(state.fbDir); closeBrowser(); }
  });
  $('#modal-backdrop').addEventListener('click', (e) => { if (e.target.id === 'modal-backdrop') closeBrowser(); });

  const input = $('#input');
  input.addEventListener('input', () => { autoGrow(input); updateSkillPopup(); });
  input.addEventListener('keydown', (e) => {
    const pop = $('#skill-popup');
    if (!pop.hidden && (e.key === 'Tab' || e.key === 'Enter')) {
      const sel = pop.querySelector('.sp-item.selected') || pop.querySelector('.sp-item');
      if (sel) { e.preventDefault(); pickSkill(sel.dataset.skill); return; }
    }
    if (!pop.hidden && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      const items = [...pop.querySelectorAll('.sp-item')];
      const idx = items.findIndex(i => i.classList.contains('selected'));
      items.forEach(i => i.classList.remove('selected'));
      const next = e.key === 'ArrowDown' ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length;
      items[next].classList.add('selected');
      return;
    }
    if (e.key === 'Escape') pop.hidden = true;
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
}

async function init() {
  wire();
  await Promise.all([checkHealth(), loadModels(), loadSkills()]);
  await refreshProjects();
  checkOllamaUpdate();
  setInterval(checkHealth, 15000);
  setInterval(checkOllamaUpdate, 6 * 60 * 60 * 1000); // server caches for 24h anyway
  // reopen most recent project if any
  if (state.projects.length) openProject(state.projects[0].id);
}

init();
