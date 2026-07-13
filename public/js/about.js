/**
 * about.js — the Help/FAQ and About modals, opened from the rail footer.
 *
 * Help is static content; About fetches /api/about for the live version and
 * build date. External links open in the default browser (the desktop shell's
 * navigation guard sends target=_blank links out to the real browser).
 */
import { $ } from './util.js';
import { initModal } from './modal.js';
import { api } from './api.js';

export function initHelpAbout() {
  const help = initModal('#help-backdrop', '#btn-close-help');
  $('#btn-help').addEventListener('click', () => help.open());

  const about = initModal('#about-backdrop', '#btn-close-about');
  $('#btn-about').addEventListener('click', async () => {
    try {
      const a = await api('/api/about');
      $('#about-version').textContent = a.version ? `v${a.version}` : '—';
      $('#about-build').textContent = a.buildDate || 'development build';
    } catch { /* keep placeholders */ }
    about.open();
  });
}
