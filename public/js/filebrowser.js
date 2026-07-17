/**
 * filebrowser.js — the in-app directory browser modal.
 *
 * A generic "pick a file or folder from this machine" dialog: navigate,
 * drill into folders, preview a file, or pick a file/folder — the caller
 * decides what "pick" means via openBrowser's opts. Attaching knowledge
 * (attachments.js) and saving a file to disk (savefile.js) are two
 * unrelated features that both drive this same picker; neither owns it, so
 * it has no default pick behavior of its own — a caller that doesn't pass
 * onPick/onPickMany just gets a browser whose pick controls do nothing.
 *
 * Two picking modes:
 *  - single (default): each row's button immediately picks that one path
 *    and closes the browser (unchanged since this module was extracted).
 *  - multi: rows get a persistent +/✓ toggle instead, building up a
 *    selection that survives navigating between folders; a footer button
 *    commits the whole batch via onPickMany([...paths]) at once.
 */
import { $, esc, toast } from './util.js';
import { api } from './api.js';
import { state } from './state.js';
import { openPreview } from './filepreview.js';

let pick = () => {};
let pickMany = null;
let pickVerb = 'attach';
let dirsOnly = false; // e.g. "Save as file…" picks a folder, never a file
let multi = false;
const selected = new Set();

/**
 * Open the browser. opts:
 *   title        — modal heading
 *   verb         — label on each row's pick button (single mode; default 'attach')
 *   dirLabel     — label on the footer "pick this folder" button
 *   dirsOnly     — hide per-file pick buttons; only folders are pickable
 *   multi        — select many files/folders across navigation before committing
 *   onPick(path) — single mode: called with the picked file or folder's path
 *   onPickMany(paths) — multi mode: called with every selected path at once
 */
export async function openBrowser(opts = {}) {
  pick = opts.onPick || (() => {});
  pickMany = opts.onPickMany || null;
  pickVerb = opts.verb || 'attach';
  dirsOnly = Boolean(opts.dirsOnly);
  multi = Boolean(opts.multi);
  selected.clear(); // fresh selection every time the browser opens
  $('#file-browser h3').textContent = opts.title || 'Attach from this machine';
  $('#btn-attach-dir').textContent = opts.dirLabel || 'Attach this folder';
  $('#btn-fb-attach-selected').hidden = !multi;
  updateSelectionUI();
  $('#modal-backdrop').hidden = false;
  await browseTo(state.fbDir || undefined);
}

/** Hand the currently open directory to the active pick handler. */
export function pickCurrentDir() {
  if (state.fbDir && state.fbDir !== '__drives__') { pick(state.fbDir); closeBrowser(); }
}

/** Commit the multi-select basket: everything toggled on, across every folder visited. */
export function commitSelection() {
  if (!selected.size || !pickMany) return;
  const paths = [...selected];
  closeBrowser();
  pickMany(paths);
}

function toggleSelect(path) {
  if (selected.has(path)) selected.delete(path); else selected.add(path);
  updateSelectionUI();
}

/** Sync every rendered select-toggle button and the footer's commit button
 *  to the current `selected` set — no re-fetch needed for a checkbox click. */
function updateSelectionUI() {
  $('#fb-entries').querySelectorAll('[data-select]').forEach(b => {
    const on = selected.has(b.dataset.select);
    b.classList.toggle('on', on);
    b.textContent = on ? '✓' : '+';
    b.title = on ? 'Remove from selection' : 'Add to selection';
  });
  const btn = $('#btn-fb-attach-selected');
  btn.textContent = selected.size ? `Attach ${selected.size} selected` : 'Attach selected';
  btn.disabled = selected.size === 0;
}

/** The row-end control: a select toggle in multi mode, an instant-pick button otherwise. */
function rowControl(path) {
  if (multi) {
    const on = selected.has(path);
    return `<button class="fb-select ${on ? 'on' : ''}" data-select="${esc(path)}" title="${on ? 'Remove from selection' : 'Add to selection'}">${on ? '✓' : '+'}</button>`;
  }
  return `<button class="fb-attach" data-attach="${esc(path)}">${esc(pickVerb)}</button>`;
}

export async function browseTo(dir) {
  try {
    const data = await api('/api/fs' + (dir ? `?dir=${encodeURIComponent(dir)}` : ''));
    state.fbDir = data.dir;
    $('#fb-path').textContent = data.dir === '__drives__' ? 'This PC' : data.dir;
    $('#btn-attach-dir').style.visibility = data.dir === '__drives__' ? 'hidden' : 'visible';
    const up = data.dir !== '__drives__' && data.parent !== data.dir
      ? `<li data-dir="${esc(data.parent)}"><span class="fb-icon">↰</span><span>..</span></li>` : '';
    $('#fb-entries').innerHTML = up + data.entries.map(e => e.isDir
      ? `<li data-dir="${esc(e.path)}"><span class="fb-icon">▣</span><span>${esc(e.name)}</span>${rowControl(e.path)}</li>`
      : `<li class="fb-file" data-file="${esc(e.path)}" title="Click to preview"><span class="fb-icon">▤</span><span class="fb-name">${esc(e.name)}</span>${
          dirsOnly ? '' : rowControl(e.path)}</li>`
    ).join('');
    $('#fb-entries').querySelectorAll('li[data-dir]').forEach(li =>
      li.addEventListener('click', (e) => { if (!e.target.dataset.attach && !e.target.dataset.select) browseTo(li.dataset.dir); }));
    // clicking a file previews it; the row-end control is what picks/selects
    $('#fb-entries').querySelectorAll('li[data-file]').forEach(li =>
      li.addEventListener('click', (e) => { if (!e.target.dataset.attach && !e.target.dataset.select) openPreview(li.dataset.file); }));
    $('#fb-entries').querySelectorAll('[data-attach]').forEach(b =>
      b.addEventListener('click', () => { pick(b.dataset.attach); closeBrowser(); }));
    $('#fb-entries').querySelectorAll('[data-select]').forEach(b =>
      b.addEventListener('click', (e) => { e.stopPropagation(); toggleSelect(b.dataset.select); }));
  } catch (e) { toast(e.message, true); }
}

export function closeBrowser() { $('#modal-backdrop').hidden = true; }
