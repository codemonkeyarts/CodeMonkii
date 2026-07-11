/**
 * server.js — lifecycle of the forked Express server.
 *
 * The web app's own server.js is run completely unmodified in a child
 * process using Electron's bundled Node (ELECTRON_RUN_AS_NODE), on the first
 * free port at/after the preferred one. Storage locations are injected via
 * environment (see settings.storageEnv). Restarting is needed whenever a
 * storage preference changes, because the server reads its config once at
 * boot.
 */
const { app, dialog } = require('electron');
const { fork } = require('child_process');
const path = require('path');
const http = require('http');
const net = require('net');
const runtime = require('./runtime');
const { storageEnv } = require('./settings');

/** Resolve to the first free TCP port at/after `start` on loopback. */
function findFreePort(start) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(findFreePort(start + 1)));
    srv.once('listening', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.listen(start, '127.0.0.1');
  });
}

/** Poll the app URL until it answers (or reject after `timeoutMs`). */
function waitForServer(port, timeoutMs = 30000) {
  const url = `http://127.0.0.1:${port}/`;
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => { res.resume(); resolve(); });
      req.on('error', () => {
        if (Date.now() - started > timeoutMs) reject(new Error('server did not start in time'));
        else setTimeout(tick, 300);
      });
    };
    tick();
  });
}

/** Fork server.js on `port` using Electron's own Node runtime. */
function startServer(port) {
  const proc = fork(path.join(runtime.APP_ROOT, 'server.js'), [], {
    cwd: runtime.APP_ROOT,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      PORT: String(port),
      ...storageEnv(),
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  runtime.serverProc = proc;
  proc.stdout?.on('data', (d) => process.stdout.write(`[server] ${d}`));
  proc.stderr?.on('data', (d) => process.stderr.write(`[server] ${d}`));
  proc.on('exit', (code) => {
    if (runtime.serverProc === proc) runtime.serverProc = null;
    if (code && !app.isQuitting && !proc.expectedExit) {
      dialog.showErrorBox('Monkii', `The server process exited unexpectedly (code ${code}).`);
      app.quit();
    }
  });
}

/** Kill the forked server, start it again with fresh env, reload the UI. */
async function restartServer() {
  await new Promise((resolve) => {
    const proc = runtime.serverProc;
    if (!proc) return resolve();
    proc.expectedExit = true;
    proc.once('exit', resolve);
    proc.kill();
  });
  startServer(runtime.serverPort);
  await waitForServer(runtime.serverPort);
  runtime.win?.webContents.reload();
}

module.exports = { findFreePort, waitForServer, startServer, restartServer };
