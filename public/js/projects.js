/**
 * projects.js — project lifecycle, the projects page, and the inspector.
 *
 * Projects live on a full-page card grid in the main area (like Claude's
 * Projects page) so the left rail stays uncluttered — the rail only carries
 * a "Projects" nav button and the open project's chats. Opening a project
 * loads its full JSON, refreshes every dependent panel, and lands the user
 * in its most recent chat (or a fresh one).
 */
import { $, esc } from './util.js';
import { api } from './api.js';
import { state } from './state.js';
import { renderSkillToggles, renderSkillChips } from './skills.js';
import { renderAttachments } from './attachments.js';
import { renderChatList, openChat, newChat } from './chat.js';
import { showView } from './views.js';

export async function refreshProjects() {
  state.projects = await api('/api/projects');
  renderProjectGrid();
}

function plural(n, word) { return `${n} ${word}${n === 1 ? '' : 's'}`; }

function renderProjectGrid() {
  const grid = $('#project-grid');
  grid.innerHTML = state.projects.map(p => `
    <div class="proj-card" data-id="${p.id}">
      <div class="pc-name">${esc(p.name)}</div>
      <div class="pc-meta">${plural(p.chatCount, 'chat')} · ${plural(p.attachmentCount, 'file')} · ${plural(p.skillCount, 'skill')}</div>
      <div class="pc-date">${new Date(p.createdAt).toLocaleDateString()}</div>
    </div>`).join('');
  grid.querySelectorAll('.proj-card').forEach(c =>
    c.addEventListener('click', () => openProject(c.dataset.id)));
}

/** Show the all-projects card grid (or the welcome screen if none exist). */
export async function showProjectsPage() {
  await refreshProjects();
  $('#inspector').hidden = true;
  showView(state.projects.length ? 'projects' : 'welcome');
}

/**
 * Chat without setting up a project first: quick chats live in an
 * auto-created "Quick Chats" project (created lazily, reused after that).
 * Reuses the latest chat if it's still empty; otherwise starts a fresh one.
 */
export async function quickChat() {
  state.projects = await api('/api/projects');
  let q = state.projects.find(p => p.name === 'Quick Chats');
  if (!q) q = await api('/api/projects', { method: 'POST', body: { name: 'Quick Chats' } });
  await openProject(q.id);
  const latest = state.project.chats[0];
  if (!latest || latest.messages.length) await newChat();
  $('#input').focus();
}

export async function createProject() {
  const p = await api('/api/projects', { method: 'POST', body: { name: 'New project' } });
  state.projects.unshift(p);
  await openProject(p.id);
  $('#inspector').hidden = false;
  const nameField = $('#proj-name');
  nameField.focus();
  nameField.select();
}

export async function openProject(pid) {
  state.project = await api(`/api/projects/${pid}`);
  state.chatId = null;
  state.invokedSkills = [];
  renderSkillChips();
  $('#chat-section').hidden = false;
  $('#rail-project-name').textContent = state.project.name;
  renderChatList();
  renderInspector();
  if (state.project.chats.length) openChat(state.project.chats[0].id);
  else await newChat();
}

export function renderInspector() {
  $('#proj-name').value = state.project.name;
  $('#proj-instructions').value = state.project.instructions;
  renderSkillToggles();
  renderAttachments();
}

export async function saveProjectMeta() {
  if (!state.project) return;
  const name = $('#proj-name').value.trim() || 'Untitled project';
  const instructions = $('#proj-instructions').value;
  if (name === state.project.name && instructions === state.project.instructions) return;
  state.project.name = name;
  state.project.instructions = instructions;
  await api(`/api/projects/${state.project.id}`, { method: 'PUT', body: { name, instructions } });
  $('#chat-project-name').textContent = name;
  $('#rail-project-name').textContent = name;
}

export async function deleteProject() {
  if (!state.project) return;
  await deleteProjectById(state.project.id);
}

/** Delete any project (inspector button or a project card's context menu). */
export async function deleteProjectById(pid) {
  const name = (state.projects.find(p => p.id === pid) || state.project || {}).name || 'this project';
  if (!confirm(`Delete project "${name}" and all its chats? This cannot be undone.`)) return;
  await api(`/api/projects/${pid}`, { method: 'DELETE' });
  if (state.project && state.project.id === pid) {
    state.project = null;
    state.chatId = null;
    $('#chat-section').hidden = true;
    $('#inspector').hidden = true;
  }
  await showProjectsPage();
}
