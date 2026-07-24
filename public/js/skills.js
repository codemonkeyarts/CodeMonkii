/**
 * skills.js — the skill catalog and both ways of activating skills.
 *
 * Loads the skill list from the server and renders:
 *   - the toggles in the skills modal (always-on per project; a browsable
 *     catalog when no project is open)
 *   - the "/" slash-command popup in the composer, which invokes a skill for
 *     the next message only, shown as removable chips above the input.
 * Creating and importing skills lives in skill-create.js.
 */
import { $, esc, toast } from './util.js';
import { api } from './api.js';
import { state } from './state.js';
import { md } from './markdown.js';
import { refreshContext } from './context-meter.js';
import { confirmDialog } from './confirm.js';

export async function loadSkills() {
  try {
    const { dir, skills } = await api('/api/skills');
    state.skills = skills;
    $('#skills-dir-hint').textContent = `drop SKILL.md folders into ${dir}`;
  } catch { state.skills = []; }
}

export function skillNames(ids) {
  return (ids || []).map(sid => {
    const s = state.skills.find(x => x.id === sid);
    return s ? s.name : sid;
  });
}

/* ---- skills modal toggles ---- */

/** Reflect how many skills are on in the inspector's "Manage skills…" button. */
function updateSkillsButton() {
  const btn = $('#btn-open-skills');
  if (!btn) return;
  const n = state.project ? (state.project.skills || []).length : 0;
  btn.textContent = n ? `Manage skills… (${n} on)` : 'Manage skills…';
}

/* With a project open, items are always-on toggles persisted to the project.
 * Without one (opened from the rail), the same modal is a browsable catalog —
 * skills are still invocable per message with "/" in any chat. */
export function renderSkillToggles() {
  updateSkillsButton();
  const hasProject = Boolean(state.project);
  $('#skills-mode-note').textContent = hasProject
    ? `Toggles load a skill into every message of "${state.project.name}". Any skill can also be invoked once with / in the composer.`
    : 'Open a project to pin always-on skills — or invoke any skill for a single message by typing / in a chat.';
  const ul = $('#skill-list');
  if (!state.skills.length) {
    ul.innerHTML = '<li class="empty">No skills found yet — each skill is a folder containing a SKILL.md with name/description frontmatter.</li>';
    return;
  }
  const enabled = new Set(hasProject ? state.project.skills || [] : []);
  ul.innerHTML = state.skills.map(s => `
    <li data-skill="${esc(s.id)}" class="${enabled.has(s.id) ? 'on' : ''}${hasProject ? '' : ' browse'}"
        title="${hasProject ? 'Always load this skill in this project' : esc('/' + s.id + ' invokes this skill in a chat')}">
      ${hasProject ? '<div class="tgl"></div>' : ''}
      <div>
        <div class="tl-name" data-skill="${esc(s.id)}" title="View skill details">${esc(s.name)}</div>
        <div class="tl-desc">${esc(s.description)}</div>
      </div>
    </li>`).join('');
  // clicking the name opens the detail view (both modes); it must not toggle
  ul.querySelectorAll('.tl-name[data-skill]').forEach(el =>
    el.addEventListener('click', (e) => { e.stopPropagation(); openSkillDetail(el.dataset.skill); }));

  if (!hasProject) return;
  ul.querySelectorAll('li[data-skill]').forEach(li => {
    li.addEventListener('click', async () => {
      const sid = li.dataset.skill;
      const set = new Set(state.project.skills || []);
      set.has(sid) ? set.delete(sid) : set.add(sid);
      state.project.skills = [...set];
      li.classList.toggle('on');
      updateSkillsButton();
      await api(`/api/projects/${state.project.id}`, { method: 'PUT', body: { skills: state.project.skills } });
    });
  });
}

/* ---- skill detail view ---- */

function fmtSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Expand/collapse a reference file's text content beneath its row. */
async function toggleRef(sid, li) {
  const next = li.nextElementSibling;
  if (next && next.classList.contains('sd-ref-body')) { next.remove(); return; }
  li.parentElement.querySelectorAll('.sd-ref-body').forEach(x => x.remove());
  try {
    const r = await api(`/api/skills/${encodeURIComponent(sid)}/file?path=${encodeURIComponent(li.dataset.ref)}`);
    const row = document.createElement('li');
    row.className = 'sd-ref-body';
    row.innerHTML = r.binary ? '<pre><em>binary file — not shown</em></pre>' : `<pre>${esc(r.text)}</pre>`;
    li.after(row);
  } catch (e) { toast(e.message, true); }
}

let currentDetail = null; // the skill currently shown/edited in the detail modal

export async function openSkillDetail(sid) {
  try {
    const d = await api(`/api/skills/${encodeURIComponent(sid)}`);
    currentDetail = d;
    cancelSkillEdit();
    $('#sd-title').textContent = d.meta.name || d.id;
    $('#sd-desc').textContent = d.meta.description || '';
    $('#sd-path').textContent = d.dir;
    $('#sd-body').innerHTML = md((d.body || '').trim() || '_No instructions written yet._');
    $('#sd-refs-count').textContent = d.files.length ? `${d.files.length} file${d.files.length === 1 ? '' : 's'}` : '';
    const refs = $('#sd-refs');
    if (!d.files.length) {
      refs.innerHTML = '<li class="empty">Just the SKILL.md — no extra files.</li>';
    } else {
      refs.innerHTML = d.files.map(f =>
        `<li data-ref="${esc(f.path)}"><span class="sd-ref-name">${esc(f.path)}</span><span class="sd-ref-size">${fmtSize(f.size)}</span></li>`
      ).join('');
      refs.querySelectorAll('li[data-ref]').forEach(li =>
        li.addEventListener('click', () => toggleRef(sid, li)));
    }
    $('#skill-detail-backdrop').hidden = false;
  } catch (e) { toast(e.message, true); }
}

/* ---- edit / delete (from the detail modal's footer) ---- */

function enterSkillEdit() {
  if (!currentDetail) return;
  $('#sd-edit-desc').value = currentDetail.meta.description || '';
  $('#sd-edit-body').value = (currentDetail.body || '').trim();
  $('#sd-body').hidden = true;
  $('#sd-edit').hidden = false;
  $('#sd-edit-desc').focus();
}

function cancelSkillEdit() {
  $('#sd-edit').hidden = true;
  $('#sd-body').hidden = false;
}

async function saveSkillEdit() {
  if (!currentDetail) return;
  const sid = currentDetail.id;
  const description = $('#sd-edit-desc').value;
  const body = $('#sd-edit-body').value;
  try {
    await api(`/api/skills/${encodeURIComponent(sid)}`, { method: 'PUT', body: { description, body } });
    await loadSkills();
    renderSkillToggles();
    await openSkillDetail(sid); // re-fetch and re-render with the saved content
    toast('Skill saved');
  } catch (e) { toast(e.message, true); }
}

/** Remove a skill entirely — from disk and from any project's always-on list. */
async function deleteSkillFlow() {
  if (!currentDetail) return;
  const { id, meta } = currentDetail;
  if (!await confirmDialog(`Delete skill "${meta.name || id}"? This removes its folder and cannot be undone.`,
    { confirmLabel: 'Delete', danger: true })) return;
  try {
    await api(`/api/skills/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (state.project) state.project.skills = (state.project.skills || []).filter(sid => sid !== id);
    state.invokedSkills = state.invokedSkills.filter(sid => sid !== id);
    renderSkillChips();
    await loadSkills();
    renderSkillToggles();
    $('#skill-detail-backdrop').hidden = true;
    currentDetail = null;
    toast(`Skill /${id} deleted`);
  } catch (e) { toast(e.message, true); }
}

/** Bind the detail modal's Edit/Save/Cancel/Delete controls (called once from main.js). */
export function initSkillDetailActions() {
  $('#btn-sd-edit').addEventListener('click', enterSkillEdit);
  $('#btn-sd-cancel-edit').addEventListener('click', cancelSkillEdit);
  $('#btn-sd-save').addEventListener('click', saveSkillEdit);
  $('#btn-sd-delete').addEventListener('click', deleteSkillFlow);
}

/* ---- "/" invocation popup + chips ---- */

export function updateSkillPopup() {
  const input = $('#input');
  const pop = $('#skill-popup');
  const m = input.value.match(/(?:^|\s)\/([\w-]*)$/);
  if (!m || !state.skills.length) { pop.hidden = true; return; }
  const q = m[1].toLowerCase();
  const matches = state.skills.filter(s =>
    s.id.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)).slice(0, 8);
  if (!matches.length) { pop.hidden = true; return; }
  pop.innerHTML = matches.map((s, i) => `
    <div class="sp-item ${i === 0 ? 'selected' : ''}" data-skill="${esc(s.id)}">
      <div class="sp-name">/${esc(s.id)}</div>
      <div class="sp-desc">${esc(s.description)}</div>
    </div>`).join('');
  pop.hidden = false;
  pop.querySelectorAll('.sp-item').forEach(item => {
    item.addEventListener('mousedown', (e) => { e.preventDefault(); pickSkill(item.dataset.skill); });
  });
}

export function pickSkill(sid) {
  const input = $('#input');
  input.value = input.value.replace(/(^|\s)\/[\w-]*$/, '$1');
  if (!state.invokedSkills.includes(sid)) state.invokedSkills.push(sid);
  renderSkillChips();
  $('#skill-popup').hidden = true;
  input.focus();
  refreshContext();
}

/**
 * Handle a composer keydown while the "/" popup is open: Tab/Enter commits
 * the highlighted skill, arrows move the selection, Escape dismisses.
 * Returns true if it consumed the key so the composer can stop.
 */
export function handleSkillPopupKey(e) {
  const pop = $('#skill-popup');
  if (pop.hidden) return false;
  if (e.key === 'Tab' || e.key === 'Enter') {
    const sel = pop.querySelector('.sp-item.selected') || pop.querySelector('.sp-item');
    if (sel) { e.preventDefault(); pickSkill(sel.dataset.skill); return true; }
  }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const items = [...pop.querySelectorAll('.sp-item')];
    const idx = items.findIndex(i => i.classList.contains('selected'));
    items.forEach(i => i.classList.remove('selected'));
    const next = e.key === 'ArrowDown' ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length;
    items[next].classList.add('selected');
    return true;
  }
  if (e.key === 'Escape') { pop.hidden = true; return true; }
  return false;
}

export function renderSkillChips() {
  $('#active-skill-chips').innerHTML = state.invokedSkills.map(sid => `
    <span class="skill-chip">/${esc(sid)}
      <button data-remove="${esc(sid)}" title="Remove">×</button>
    </span>`).join('');
  document.querySelectorAll('#active-skill-chips [data-remove]').forEach(b =>
    b.addEventListener('click', () => {
      state.invokedSkills = state.invokedSkills.filter(s => s !== b.dataset.remove);
      renderSkillChips();
      refreshContext();
    }));
}
