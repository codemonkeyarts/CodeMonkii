/**
 * dialogs.js — native-dialog helpers shared across the shell.
 */
const { dialog } = require('electron');
const runtime = require('./runtime');

/** Native directory picker; resolves to the chosen path, or null if canceled. */
async function pickFolder(title) {
  const { canceled, filePaths } = await dialog.showOpenDialog(runtime.win, {
    title,
    properties: ['openDirectory', 'createDirectory'],
  });
  return canceled || !filePaths[0] ? null : filePaths[0];
}

module.exports = { pickFolder };
