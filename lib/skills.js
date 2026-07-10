/**
 * skills.js — Claude-style skill discovery and loading.
 *
 * A skill is a folder inside the skills directory containing a SKILL.md with
 * YAML frontmatter (name, description) followed by markdown instructions —
 * the same format Claude Code uses, so existing skills work unmodified.
 * This module scans that directory, parses frontmatter (a deliberately tiny
 * parser: key/value pairs with folded multiline values), and returns skill
 * bodies for injection into the system prompt.
 */
const fs = require('fs');
const path = require('path');
const { SKILLS_DIR, IMPORT_MAX_FILES, IMPORT_MAX_BYTES } = require('./config');

fs.mkdirSync(SKILLS_DIR, { recursive: true });

function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  let curKey = null;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s?(.*)$/);
    if (kv) { curKey = kv[1]; meta[curKey] = kv[2].trim(); }
    else if (curKey && /^\s+\S/.test(line)) meta[curKey] += ' ' + line.trim(); // folded multiline
  }
  return { meta, body: m[2] };
}

function scanSkills() {
  const skills = [];
  for (const entry of fs.readdirSync(SKILLS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillFile = path.join(SKILLS_DIR, entry.name, 'SKILL.md');
    if (!fs.existsSync(skillFile)) continue;
    try {
      const raw = fs.readFileSync(skillFile, 'utf8');
      const { meta, body } = parseFrontmatter(raw);
      skills.push({
        id: entry.name,
        name: meta.name || entry.name,
        description: meta.description || '',
        size: body.length,
      });
    } catch { /* skip unreadable skill */ }
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

function skillBody(sid) {
  if (/[\\/]|\.\./.test(sid)) throw new Error('bad skill id');
  const raw = fs.readFileSync(path.join(SKILLS_DIR, sid, 'SKILL.md'), 'utf8');
  const { meta, body } = parseFrontmatter(raw);
  return { meta, body };
}

/* ---- creation ---- */

const TEMPLATE_PATH = path.join(__dirname, 'skill-template.md');

/** "My Cool Skill!" -> "my-cool-skill" (folder name = skill id). */
function slugify(name) {
  return String(name).toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

/**
 * Scaffold a new skill folder and return its catalog entry. The SKILL.md
 * body comes from lib/skill-template.md, or from `body` when provided
 * (e.g. instructions written by a local model). Throws with a human-readable
 * message on invalid names or collisions; never writes outside SKILLS_DIR
 * (the id is a strict slug).
 */
function createSkill(name, description, body) {
  const id = slugify(name);
  if (!id) throw new Error('skill name must contain letters or numbers');
  const dir = path.join(SKILLS_DIR, id);
  if (fs.existsSync(path.join(dir, 'SKILL.md'))) throw new Error(`skill "${id}" already exists`);

  const desc = String(description || '').trim().replace(/\r?\n/g, ' ')
    || 'One line describing when to use this skill.';
  const content = body
    ? `---\nname: ${id}\ndescription: ${desc}\n---\n\n${body.trim()}\n`
    : fs.readFileSync(TEMPLATE_PATH, 'utf8')
        .replace('{{name}}', id)
        .replace('{{description}}', desc);

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), content);
  return { id, name: id, description: desc, path: path.join(dir, 'SKILL.md') };
}

/**
 * Have a local model write the skill's instructions and scaffold the folder
 * with them. The name + description act as the brief. Reasoning-model think
 * tags and whole-document code fences are stripped before writing the file.
 */
async function generateSkill(name, description, model) {
  const { chatOnce } = require('./ollama'); // lazy: avoid loading at startup
  let body = await chatOnce({
    model,
    messages: [
      {
        role: 'system',
        content: 'You write skill files for a local LLM studio. A skill is a markdown document injected into the system prompt when active, so write clear, direct instructions addressed to the model that will follow them. Output ONLY the markdown body — no YAML frontmatter, no code fences around the document, no commentary before or after.',
      },
      {
        role: 'user',
        content: `Skill name: ${name.trim()}\nPurpose: ${description.trim()}\n\nWrite the skill instructions with three sections: "## Role" (the expertise to adopt), "## When to use" (what requests it applies to), and "## Guidelines" (concrete, checkable rules — include a short example if output format matters). Keep it under 400 words.`,
      },
    ],
  });
  body = body
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/^\s*```(?:markdown|md)?\s*\n([\s\S]*?)\n\s*```\s*$/g, '$1')
    .trim();
  if (!body) throw new Error('the model returned an empty document — try another model');
  return createSkill(name, description, body);
}

/**
 * Copy an existing skill folder from anywhere on disk into SKILLS_DIR and
 * return its catalog entry. Accepts a folder or a SKILL.md file (its parent
 * folder is used). Refuses folders without a SKILL.md, collisions, and
 * re-importing something already inside the skills directory. Heavy
 * subfolders (node_modules, .git) are skipped during the copy.
 */
function importSkill(srcPath) {
  let src = path.resolve(srcPath);
  if (fs.statSync(src).isFile()) src = path.dirname(src);
  if (!fs.existsSync(path.join(src, 'SKILL.md'))) throw new Error('no SKILL.md found in that folder');

  const real = fs.realpathSync.native(src).toLowerCase() + path.sep;
  const skillsReal = fs.realpathSync.native(SKILLS_DIR).toLowerCase() + path.sep;
  if (real.startsWith(skillsReal)) throw new Error('that skill is already in your skills folder');

  const id = slugify(path.basename(src));
  if (!id) throw new Error('folder name must contain letters or numbers');
  const dest = path.join(SKILLS_DIR, id);
  if (fs.existsSync(path.join(dest, 'SKILL.md'))) throw new Error(`skill "${id}" already exists`);

  const skipHeavy = (p) => !/(^|[\\/])(node_modules|\.git)([\\/]|$)/.test(p);

  /* Size sanity before touching anything: skills are text — a folder that
   * merely contains a SKILL.md next to gigabytes of other data is almost
   * certainly not a skill, and copying it would fill the disk. */
  let files = 0;
  let bytes = 0;
  (function tally(dir, depth) {
    if (depth > 8) throw new Error('folder is nested too deeply to be a skill');
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (!skipHeavy(full)) continue;
      if (e.isDirectory()) tally(full, depth + 1);
      else if (e.isFile()) {
        files += 1;
        bytes += fs.statSync(full).size;
        if (files > IMPORT_MAX_FILES) throw new Error(`too many files to be a skill (over ${IMPORT_MAX_FILES})`);
        if (bytes > IMPORT_MAX_BYTES) throw new Error(`folder too large to be a skill (over ${Math.round(IMPORT_MAX_BYTES / 1e6)} MB)`);
      }
    }
  })(src, 0);

  fs.cpSync(src, dest, { recursive: true, filter: skipHeavy });
  const { meta } = parseFrontmatter(fs.readFileSync(path.join(dest, 'SKILL.md'), 'utf8'));
  return { id, name: meta.name || id, description: meta.description || '' };
}

module.exports = { parseFrontmatter, scanSkills, skillBody, createSkill, generateSkill, importSkill };
