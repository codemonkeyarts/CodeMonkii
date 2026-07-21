/**
 * routes/search.js — search across every project's names, chats, and messages.
 *
 * Single-user, local scale: rather than maintain a search index, every
 * search just loads all project files via lib/store's listProjects() — the
 * same cost the projects list page already pays — and does a plain
 * case-insensitive substring match. Simple, predictable, and correct; no
 * fuzzy-matching surprises to explain.
 */
const express = require('express');
const { listProjects } = require('../lib/store');

const router = express.Router();

const MAX_RESULTS = 60;
const SNIPPET_RADIUS = 50; // chars of context kept on each side of a match
const MAX_QUERY_LEN = 300;

const isLowSurrogate = (c) => c >= 0xdc00 && c <= 0xdfff;
const isHighSurrogate = (c) => c >= 0xd800 && c <= 0xdbff;

/** A short, match-centered excerpt with … markers where it was trimmed.
 *  Shrinks the boundary inward rather than outward so a UTF-16 surrogate
 *  pair (e.g. an emoji) never gets split into an orphaned half. */
function snippet(text, at, len) {
  let start = Math.max(0, at - SNIPPET_RADIUS);
  if (start > 0 && isLowSurrogate(text.charCodeAt(start))) start++;
  let end = Math.min(text.length, at + len + SNIPPET_RADIUS);
  if (end < text.length && isHighSurrogate(text.charCodeAt(end - 1))) end--;
  return (start > 0 ? '…' : '') + text.slice(start, end).replace(/\s+/g, ' ').trim() + (end < text.length ? '…' : '');
}

router.get('/search', (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, MAX_QUERY_LEN) : '';
  if (q.length < 2) return res.json({ results: [] }); // avoid a flood of noise on one character
  const needle = q.toLowerCase();
  const results = [];

  outer:
  for (const p of listProjects()) {
    if (p.name.toLowerCase().includes(needle)) {
      results.push({ type: 'project', projectId: p.id, projectName: p.name });
      if (results.length >= MAX_RESULTS) break outer;
    }
    for (const c of p.chats || []) {
      if (c.title.toLowerCase().includes(needle)) {
        results.push({ type: 'chat', projectId: p.id, projectName: p.name, chatId: c.id, chatTitle: c.title });
        if (results.length >= MAX_RESULTS) break outer;
      }
      for (let idx = 0; idx < c.messages.length; idx++) {
        const m = c.messages[idx];
        const lower = m.content.toLowerCase();
        const at = lower.indexOf(needle);
        if (at === -1) continue;
        results.push({
          type: 'message', projectId: p.id, projectName: p.name, chatId: c.id, chatTitle: c.title,
          messageIdx: idx, role: m.role, snippet: snippet(m.content, at, needle.length),
        });
        if (results.length >= MAX_RESULTS) break outer;
      }
    }
  }
  res.json({ results });
});

module.exports = router;
