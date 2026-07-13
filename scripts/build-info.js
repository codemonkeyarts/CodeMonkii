/**
 * build-info.js — run electron-builder with today's date baked in.
 *
 * `npm run dist` calls this instead of electron-builder directly, so the date
 * of the build is merged into the packaged package.json as `buildDate` (via
 * electron-builder's extraMetadata). The About dialog reads it back. Signing
 * still works — the CSC_* env vars are inherited by the child process.
 */
const { execSync } = require('child_process');

const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
execSync(`electron-builder -c.extraMetadata.buildDate=${date}`, { stdio: 'inherit' });
