/**
 * savefile.js — "Save as file…": write chat content to disk.
 *
 * Reuses the file browser in folder-picking mode (dirsOnly — only folders are
 * pickable, and its pick verb reads "save here" instead of "attach") to
 * choose a destination, then a small in-app filename dialog (never
 * window.prompt(): the native dialog drops Electron's keyboard focus, same
 * reason the app has its own confirm dialog) before writing through
 * /api/fs/write. An existing file is never silently overwritten — the write
 * 409s and the user is asked to confirm before it's retried with overwrite.
 * A successful save opens a preview of the file, so you can see it landed
 * right rather than just trusting a toast.
 */
import { $, toast } from './util.js';
import { api } from './api.js';
import { openBrowser } from './filebrowser.js';
import { openPreview } from './filepreview.js';
import { confirmDialog } from './confirm.js';

let resolveName = null;

function closeNameDialog(name) {
  $('#savefile-backdrop').hidden = true;
  const r = resolveName;
  resolveName = null;
  if (r) r(name);
}

/** Prompt for a filename inside `dir`; resolves the trimmed name, or null if canceled. */
function askFilename(dir, suggested) {
  return new Promise((resolve) => {
    if (resolveName) closeNameDialog(null); // clear any pending dialog first
    resolveName = resolve;
    $('#savefile-dir').textContent = dir;
    const input = $('#savefile-name');
    input.value = suggested;
    $('#savefile-backdrop').hidden = false;
    input.focus();
    // select the basename only (not the extension), like a native save dialog
    const dot = suggested.lastIndexOf('.');
    input.setSelectionRange(0, dot > 0 ? dot : suggested.length);
  });
}

/** A short name to seed the filename dialog with: `hint` (e.g. a chat title)
 *  if given, else the content's first non-blank line — either way slugged
 *  into something filesystem-safe. "# Chapter One" → chapter-one.md */
function suggestName(content, hint) {
  const first = hint || content.split('\n').find(l => l.trim()) || 'message';
  const slug = first.replace(/^#+\s*/, '').trim().slice(0, 50)
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, ' ').replace(/\s+/g, '-').replace(/^-+|-+$/g, '');
  return `${slug || 'message'}.md`;
}

async function writeFile(dir, filename, content, overwrite) {
  try {
    const res = await api('/api/fs/write', { method: 'POST', body: { dir, filename, content, overwrite } });
    toast(`Saved: ${res.path}`);
    openPreview(res.path); // confirm it landed right, not just trust the toast
    return true;
  } catch (e) {
    if (e.body?.exists) {
      const replace = await confirmDialog(`"${filename}" already exists in this folder. Replace it?`,
        { confirmLabel: 'Replace', danger: true });
      return replace ? writeFile(dir, filename, content, true) : false;
    }
    toast(e.message, true);
    return false;
  }
}

/** Entry point: save `content` (e.g. a chat message or a whole exported
 *  conversation) to a file the user picks. `nameHint` overrides the
 *  suggested filename — a whole-conversation export wants the chat title,
 *  not its first message's first line. */
export function saveAsFile(content, nameHint) {
  if (!content || !content.trim()) { toast('Nothing to save', true); return; }
  openBrowser({
    title: 'Save file to…',
    verb: 'save here',
    dirLabel: 'Save in this folder',
    dirsOnly: true,
    onPick: async (dir) => {
      const filename = await askFilename(dir, suggestName(content, nameHint));
      if (filename) await writeFile(dir, filename, content, false);
    },
  });
}

export function initSaveFile() {
  $('#btn-savefile-cancel').addEventListener('click', () => closeNameDialog(null));
  $('#btn-close-savefile').addEventListener('click', () => closeNameDialog(null));
  $('#savefile-backdrop').addEventListener('click', (e) => { if (e.target.id === 'savefile-backdrop') closeNameDialog(null); });
  $('#btn-savefile-save').addEventListener('click', () => {
    const name = $('#savefile-name').value.trim();
    if (!name) { toast('Enter a file name', true); return; }
    closeNameDialog(name);
  });
  $('#savefile-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); $('#btn-savefile-save').click(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeNameDialog(null); }
  });
}
