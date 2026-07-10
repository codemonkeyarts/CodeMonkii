/**
 * views.js — switching between the main area's views.
 *
 * The main area shows exactly one of: the welcome screen, the all-projects
 * page, or a chat. Every module that needs to change what's on screen calls
 * showView instead of toggling `hidden` flags by hand, so the set of views
 * (and the guarantee that only one is visible) lives in one place. To add a
 * view: add its element id here and call showView('<name>').
 */
import { $ } from './util.js';

const VIEWS = {
  welcome: '#welcome',
  projects: '#projects-page',
  chat: '#chat-view',
};

export function showView(name) {
  for (const [key, sel] of Object.entries(VIEWS)) $(sel).hidden = key !== name;
}
