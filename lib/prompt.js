/**
 * prompt.js — system prompt assembly.
 *
 * Builds the single system message sent to the model for each chat request,
 * layering (in order): a base persona, the project's custom instructions,
 * every enabled/invoked skill's SKILL.md body, and attached file contents —
 * the project's attachments plus the current chat's own. Sections are
 * separated with --- rules so smaller local models can tell them apart.
 */
const { SKILL_LIMIT } = require('./config');
const { skillBody } = require('./skills');
const { attachmentContext } = require('./attachments');

function buildSystem(project, extraSkillIds, chat) {
  const sections = [];
  sections.push(
    'You are a capable assistant running locally. Answer directly and helpfully. ' +
    'When project files are provided, ground your answers in them and cite file paths.'
  );
  if (project.instructions && project.instructions.trim()) {
    sections.push(`# Project instructions\n${project.instructions.trim()}`);
  }
  const skillIds = [...new Set([...(project.skills || []), ...(extraSkillIds || [])])];
  for (const sid of skillIds) {
    try {
      const { meta, body } = skillBody(sid);
      // skills share the context with attachments and history — cap each one
      let text = body.trim();
      if (text.length > SKILL_LIMIT) {
        text = text.slice(0, SKILL_LIMIT) + `\n… [skill truncated: ${body.length} chars, showing first ${SKILL_LIMIT}]`;
      }
      sections.push(`# Skill: ${meta.name || sid}\n${meta.description ? meta.description + '\n\n' : ''}${text}`);
    } catch { /* skill removed from disk; ignore */ }
  }
  const attachments = [...(project.attachments || []), ...((chat && chat.attachments) || [])];
  if (attachments.length) {
    const { parts, errors } = attachmentContext(attachments);
    if (parts.length) {
      sections.push(`# Knowledge\nThe user attached these files from their machine (read live from disk):\n\n${parts.join('\n\n')}`);
    }
    if (errors.length) sections.push(`# Attachment notes\n${errors.join('\n')}`);
  }
  return sections.join('\n\n---\n\n');
}

module.exports = { buildSystem };
