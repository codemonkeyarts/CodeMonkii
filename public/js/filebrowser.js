/**
 * filebrowser.js — the in-app directory browser modal.
 *
 * A generic "pick a file or folder from this machine" dialog: navigate,
 * drill into folders, preview a file, or pick a file/folder — the caller
 * decides what "pick" means via openBrowser's opts. Attaching knowledge
 * (attachments.js) and saving a file to disk (savefile.js) are two
 * unrelated features that both drive this same picker; neither owns it, so
 * it has no default pick behavior of its own — a caller that doesn't pass
 * onPick just gets a browser whose pick buttons do nothing.
 */
import { $, esc, toast } from './util.js';
import { api } from './api.js';
import { state } from './state.js';
import { openPreview } from './filepreview.js';

let pick = () => {};
let pickVerb = 'attach';
let dirsOnly = false; // e.g. "Save as file…" picks a folder, never a file

/**
 * Open the browser. opts:
 *   title     — modal heading
 *   verb      — label on each row's pick button (default 'attach')
 *   dirLabel  — label on the footer "pick this folder" button
 *   dirsOnly  — hide per-file pick buttons; only folders are pickable
 *   onPick(path) — called with the picked file or folder's path
 */
export async function openBrowser(opts = {}) {
  pick = opts.onPick || (() => {});
  pickVerb = opts.verb || 'attach';
  dirsOnly = Boolean(opts.dirsOnly);
  $('#file-browser h3').textContent = opts.title || 'Attach from this machine';
  $('#btn-attach-dir').textContent = opts.dirLabel || 'Attach this folder';
  $('#modal-backdrop').hidden = false;
  await browseTo(state.fbDir || undefined);
}

/** Hand the currently open directory to the active pick handler. */
export function pickCurrentDir() {
  if (state.fbDir && state.fbDir !== '__drives__') { pick(state.fbDir); closeBrowser(); }
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
      ? `<li data-dir="${esc(e.path)}"><span class="fb-icon">▣</span><span>${esc(e.name)}</span><button class="fb-attach" data-attach="${esc(e.path)}">${esc(pickVerb)}</button></li>`
      : `<li class="fb-file" data-file="${esc(e.path)}" title="Click to preview"><span class="fb-icon">▤</span><span class="fb-name">${esc(e.name)}</span>${
          dirsOnly ? '' : `<button class="fb-attach" data-attach="${esc(e.path)}">${esc(pickVerb)}</button>`}</li>`
    ).join('');
    $('#fb-entries').querySelectorAll('li[data-dir]').forEach(li =>
      li.addEventListener('click', (e) => { if (!e.target.dataset.attach) browseTo(li.dataset.dir); }));
    // clicking a file previews it; the button (when shown) is what picks/attaches
    $('#fb-entries').querySelectorAll('li[data-file]').forEach(li =>
      li.addEventListener('click', (e) => { if (!e.target.dataset.attach) openPreview(li.dataset.file); }));
    $('#fb-entries').querySelectorAll('[data-attach]').forEach(b =>
      b.addEventListener('click', () => { pick(b.dataset.attach); closeBrowser(); }));
  } catch (e) { toast(e.message, true); }
}

export function closeBrowser() { $('#modal-backdrop').hidden = true; }
