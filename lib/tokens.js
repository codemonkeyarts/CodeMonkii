/**
 * tokens.js — rough token estimation.
 *
 * There is no universal tokenizer available offline across model families,
 * so this uses the well-worn ~4-characters-per-token heuristic. It is an
 * estimate, surfaced to the user with a "~", used only to warn before a
 * request likely overflows the chosen context length — never for anything
 * that must be exact.
 */
const estimateTokens = (text) => Math.ceil((text || '').length / 4);

module.exports = { estimateTokens };
