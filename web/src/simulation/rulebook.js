export const RULEBOOK_ACTIONS = Object.freeze({
  COMLOST: Object.freeze(['CONTINUE', 'LANDNEARESTAIRPORT', 'RETURNTOORIGIN']),
  DESTCLOSED: Object.freeze(['LANDNEARESTAIRPORT', 'RETURNTOORIGIN']),
  NOGOREGION: Object.freeze(['DETOUR', 'HOLD']),
});

export const RULEBOOK_MAX_LENGTH = 4096;
export const RULEBOOK_MAX_LINES = 20;

/** Parse declarative overrides only; omitted triggers retain engine defaults. */
export function parseRulebook(text) {
  if (typeof text !== 'string') throw new TypeError('Line 1: rulebook must be text.');
  if (text.length > RULEBOOK_MAX_LENGTH) {
    const line = text.slice(0, RULEBOOK_MAX_LENGTH).split(/\r\n|\n|\r/).length;
    throw new Error(`Line ${line}: rulebook exceeds ${RULEBOOK_MAX_LENGTH} characters.`);
  }
  const rules = [];
  const seen = new Map();
  const lines = text.split(/\r\n|\n|\r/);
  if (lines.length > RULEBOOK_MAX_LINES) throw new Error(`Line ${RULEBOOK_MAX_LINES + 1}: rulebook exceeds ${RULEBOOK_MAX_LINES} lines (including comments and blanks).`);
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    const number = index + 1;
    if (!line || line.startsWith('#')) continue;
    const match = /^([A-Z_][A-Z0-9_]*)\s*:\s*([A-Z_][A-Z0-9_]*)$/i.exec(line);
    if (!match) throw new Error(`Line ${number}: expected TRIGGER: ACTION (one rule per line; comments start with # on their own line).`);
    const trigger = match[1].toUpperCase();
    const action = match[2].toUpperCase();
    if (!Object.hasOwn(RULEBOOK_ACTIONS, trigger)) {
      throw new Error(`Line ${number}: unknown trigger "${trigger}". Supported triggers: ${Object.keys(RULEBOOK_ACTIONS).join(', ')}.`);
    }
    if (!RULEBOOK_ACTIONS[trigger].includes(action)) {
      throw new Error(`Line ${number}: unknown action "${action}" for ${trigger}. Supported actions: ${RULEBOOK_ACTIONS[trigger].join(', ')}.`);
    }
    if (seen.has(trigger)) throw new Error(`Line ${number}: duplicate trigger ${trigger}; first defined on line ${seen.get(trigger)}.`);
    seen.set(trigger, number);
    rules.push({ trigger, action });
  }
  return rules;
}
