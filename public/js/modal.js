/**
 * modal.js — shared open/close behavior for backdrop modals.
 *
 * A modal is a fixed backdrop element containing a panel; closing happens
 * via its × button or a click on the backdrop itself. initModal wires both
 * once and returns { open, close } handles. (The file browser keeps its own
 * wiring in attachments.js because closing it also clears browse state.)
 */
import { $ } from './util.js';

export function initModal(backdropSel, closeBtnSel) {
  const backdrop = $(backdropSel);
  const close = () => { backdrop.hidden = true; };
  $(closeBtnSel).addEventListener('click', close);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  return { open: () => { backdrop.hidden = false; }, close };
}
