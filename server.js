/**
 * server.js — application entry point.
 *
 * Wires everything together and nothing more: applies the security
 * middleware, mounts the API routers, serves the static frontend, installs
 * the leak-free error handler, and starts listening on loopback. All real
 * logic lives in lib/ (domain modules) and routes/ (HTTP endpoints):
 *
 *   lib/config.js       env + constants          routes/projects.js  projects/chats/attachments CRUD
 *   lib/security.js     host/origin/CSP + fs allowlist   routes/skills.js    skill listing
 *   lib/store.js        project JSON persistence  routes/fs.js        file-browser listings
 *   lib/skills.js       SKILL.md parsing          routes/ollama.js    health/models/update/chat stream
 *   lib/attachments.js  reading knowledge from disk   routes/search.js    search across projects/chats/messages
 *   lib/prompt.js       system prompt assembly
 *   lib/ollama.js       Ollama HTTP client + update check
 */
const path = require('path');
const express = require('express');

const { PORT, OLLAMA, SKILLS_DIR, ROOT } = require('./lib/config');
const { securityMiddleware } = require('./lib/security');
const { checkOllamaUpdate } = require('./lib/ollama');
const { logError, logInfo, LOG_DIR } = require('./lib/log');

// last-resort logging so nothing dies silently
process.on('uncaughtException', (e) => logError('uncaughtException', e));
process.on('unhandledRejection', (e) => logError('unhandledRejection', e));

const app = express();
app.disable('x-powered-by');
app.use(securityMiddleware);
app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(ROOT, 'public')));

app.use('/api', require('./routes/projects'));
app.use('/api', require('./routes/skills'));
app.use('/api', require('./routes/fs'));
app.use('/api', require('./routes/search'));
app.use('/api', require('./routes/ollama'));
app.use('/api', require('./routes/backup'));

/* JSON error handler — no stack traces to the client, but log the real one */
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.type === 'entity.parse.failed' ? 400
    : err.type === 'entity.too.large' ? 413
    : err.status || 500;
  if (status >= 500) logError(`${req.method} ${req.path}`, err);
  res.status(status).json({ error: status < 500 ? 'invalid request body' : 'internal error' });
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Monkii running at http://localhost:${PORT}`);
  console.log(`Ollama host: ${OLLAMA}`);
  console.log(`Skills dir:  ${SKILLS_DIR}`);
  console.log(`Logs dir:    ${LOG_DIR}`);
  logInfo('server started', `port ${PORT}`);
  checkOllamaUpdate().then(u => {
    if (u.updateAvailable) console.log(`Ollama update available: ${u.current} -> ${u.latest} (${u.url})`);
    else if (u.current) console.log(`Ollama ${u.current} is up to date`);
  });
});
