// Lost-communication procedures, built like Lego/Scratch blocks: an ordered list an aircraft
// executes block by block when it hears nothing from its controlling ATC.
//
// Text form, one block per line: `Name = value`, `Name value` or a bare `Name` (bare blocks use
// their default value). Names ignore case, spaces and underscores, so `CircleAround = 30`,
// `circle_around 30` and `CIRCLE AROUND = 30` are the same block. `#` lines are comments.
// Schematic coordination commands, not ICAO radio-failure procedures.

export const PROCEDURE_MAX_LENGTH = 1024;
export const PROCEDURE_MAX_COMMANDS = 12;
export const PROCEDURE_MAX_LINES = 40;

// The block palette, in display order. `command` is the engine step command.
export const PROCEDURE_BLOCKS = Object.freeze([
  Object.freeze({ id: 'Squawk', label: 'Squawk', command: 'SQUAWK', color: '#f59e0b',
    param: Object.freeze({ kind: 'code', default: '7600' }),
    description: 'Set the transponder code at once; 7600 tells radar this aircraft has lost its radio.' }),
  Object.freeze({ id: 'Continue', label: 'Continue', command: 'CONTINUE', color: '#22c55e',
    param: Object.freeze({ kind: 'minutes', min: 1, max: 60, default: 3, unit: 'min' }),
    description: 'Keep flying the cleared route for this many minutes while listening for ATC to come back.' }),
  Object.freeze({ id: 'Hold', label: 'Hold', command: 'HOLD', color: '#fb923c',
    param: Object.freeze({ kind: 'minutes', min: 1, max: 30, default: 3, unit: 'min' }),
    description: 'Stop moving along the route for this many minutes, or simply keep waiting if already queued to land.' }),
  Object.freeze({ id: 'CircleAround', label: 'Circle around', command: 'CIRCLE', color: '#a78bfa',
    param: Object.freeze({ kind: 'minutes', min: 1, max: 60, default: 5, unit: 'min' }),
    description: 'Fly a holding circle where the aircraft is for this many minutes, making no progress along the route.' }),
  Object.freeze({ id: 'Relay', label: 'Relay', command: 'RELAY', color: '#38bdf8', param: null,
    description: 'Ask nearby aircraft to pass this aircraft’s requests on to ATC from now on.' }),
  Object.freeze({ id: 'Divert', label: 'Divert', command: 'DIVERT', color: '#f43f5e',
    param: Object.freeze({ kind: 'target', default: 'NEAREST' }),
    description: 'Ask the nearest open airport, the origin or a named airport to accept the aircraft, then fly there; this ends the procedure.' }),
]);

export const PROCEDURE_BLOCK_BY_COMMAND = Object.freeze(Object.fromEntries(PROCEDURE_BLOCKS.map(block => [block.command, block])));

// Help rows for the UI (kept for callers that list commands as text).
export const PROCEDURE_COMMANDS = Object.freeze(PROCEDURE_BLOCKS.map(block => Object.freeze({
  id: block.id,
  syntax: block.param ? `${block.id} = ${paramSyntax(block.param)}` : block.id,
  description: block.description,
})));

// The protocol the UI puts in effect for every aircraft (settings.procedures.default).
// The engine's own default stays derived from the rulebook COMLOST action, so tests keep their timings.
export const SUGGESTED_PROCEDURE_TEXT = 'Squawk = 7600\nContinue = 3\nRelay\nCircleAround = 5\nDivert = NEAREST';

const normaliseName = name => String(name).replace(/[\s_]/g, '').toUpperCase();
const BLOCK_BY_NAME = Object.fromEntries(PROCEDURE_BLOCKS.flatMap(block => [
  [normaliseName(block.id), block], [block.command, block],
]));

function paramSyntax(param) {
  if (param.kind === 'code') return '<4 octal digits>';
  if (param.kind === 'target') return 'NEAREST | ORIGIN | <IATA>';
  return `<${param.min}–${param.max} minutes>`;
}

function lineOf(text, index) {
  return text.slice(0, index).split(/\r\n|\n|\r/).length;
}

/**
 * Split text into `{ line, name, value, raw }` tokens without validating them.
 * Blank and `#` lines are skipped; `value` is null when the line has none.
 */
export function tokenizeProcedure(text) {
  if (typeof text !== 'string') return [];
  const tokens = [];
  for (const [index, raw] of text.split(/\r\n|\n|\r/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    let name;
    let value;
    const equals = line.indexOf('=');
    if (equals >= 0) {
      name = line.slice(0, equals).trim();
      value = line.slice(equals + 1).trim();
    } else {
      // Without "=", take the longest leading words that spell a block name ("Circle Around 30").
      const words = line.split(/\s+/);
      let split = 1;
      for (let count = words.length; count >= 1; count -= 1) {
        if (BLOCK_BY_NAME[normaliseName(words.slice(0, count).join(''))]) { split = count; break; }
      }
      name = words.slice(0, split).join(' ');
      value = words.slice(split).join(' ');
    }
    tokens.push({ line: index + 1, name, value: value === '' ? null : value, raw });
  }
  return tokens;
}

function parseValue(block, value, number) {
  const param = block.param;
  if (!param) {
    if (value !== null) throw new Error(`Line ${number}: ${block.id} takes no value.`);
    return {};
  }
  const text = value ?? String(param.default);
  if (param.kind === 'code') {
    if (!/^[0-7]{4}$/.test(text)) throw new Error(`Line ${number}: ${block.id} takes four octal digits (0–7), e.g. ${block.id} = 7600.`);
    return { code: text };
  }
  if (param.kind === 'minutes') {
    const minutes = Number(text);
    if (!/^\d+$/.test(text) || minutes < param.min || minutes > param.max) {
      throw new Error(`Line ${number}: ${block.id} takes a whole number of minutes from ${param.min} to ${param.max}, e.g. ${block.id} = ${param.default}.`);
    }
    return { minutes };
  }
  const target = text.toUpperCase();
  if (!(target === 'NEAREST' || target === 'ORIGIN' || /^[A-Z]{3}$/.test(target))) {
    throw new Error(`Line ${number}: ${block.id} takes NEAREST, ORIGIN or a three-letter airport code, e.g. ${block.id} = NEAREST.`);
  }
  return { target };
}

/** Parse procedure text into steps. Errors name the offending line, like the rulebook parser. */
export function parseProcedure(text) {
  if (typeof text !== 'string') throw new TypeError('Line 1: procedure must be text.');
  if (text.length > PROCEDURE_MAX_LENGTH) {
    throw new Error(`Line ${lineOf(text, PROCEDURE_MAX_LENGTH)}: procedure exceeds ${PROCEDURE_MAX_LENGTH} characters.`);
  }
  const lineCount = text.split(/\r\n|\n|\r/).length;
  if (lineCount > PROCEDURE_MAX_LINES) {
    throw new Error(`Line ${PROCEDURE_MAX_LINES + 1}: procedure exceeds ${PROCEDURE_MAX_LINES} lines (including comments and blanks).`);
  }
  const steps = [];
  for (const token of tokenizeProcedure(text)) {
    const block = BLOCK_BY_NAME[normaliseName(token.name)];
    if (!block) {
      throw new Error(`Line ${token.line}: unknown block "${token.name}". Blocks: ${PROCEDURE_BLOCKS.map(item => item.id).join(', ')}.`);
    }
    if (steps.at(-1)?.command === 'DIVERT') {
      throw new Error(`Line ${token.line}: Divert ends the procedure; remove the blocks after it.`);
    }
    if (steps.length >= PROCEDURE_MAX_COMMANDS) {
      throw new Error(`Line ${token.line}: a procedure has at most ${PROCEDURE_MAX_COMMANDS} blocks.`);
    }
    steps.push({ command: block.command, ...parseValue(block, token.value, token.line) });
  }
  return steps;
}

/** One step in canonical `Name = value` form. */
export function formatStep(step) {
  const block = PROCEDURE_BLOCK_BY_COMMAND[step?.command];
  if (!block) return String(step?.command ?? '');
  if (!block.param) return block.id;
  const value = block.param.kind === 'code' ? step.code : block.param.kind === 'target' ? step.target : step.minutes;
  return `${block.id} = ${value ?? block.param.default}`;
}

export function formatProcedure(steps) {
  return (steps ?? []).map(formatStep).join('\n');
}

/** A fresh step for a palette block, using its default parameter. */
export function defaultStep(block) {
  const param = block?.param;
  if (!param) return { command: block.command };
  if (param.kind === 'code') return { command: block.command, code: param.default };
  if (param.kind === 'target') return { command: block.command, target: param.default };
  return { command: block.command, minutes: param.default };
}

/** Procedure implied by the rulebook `COMLOST` action (engine default when nothing is configured). */
export function defaultProcedure(comlostAction = 'CONTINUE') {
  const squawk = { command: 'SQUAWK', code: '7600' };
  if (comlostAction === 'LANDNEARESTAIRPORT') return [squawk, { command: 'DIVERT', target: 'NEAREST' }];
  if (comlostAction === 'RETURNTOORIGIN') return [squawk, { command: 'DIVERT', target: 'ORIGIN' }];
  return [squawk];
}

const isSet = text => typeof text === 'string' && text.trim() !== '';

function parseLabelled(text, label) {
  try {
    return parseProcedure(text);
  } catch (error) {
    throw new Error(`${label}: ${error.message}`);
  }
}

/**
 * Procedure for every aircraft: its own (`byAgent`), else the shared `default`, else the rulebook.
 * `spec` is `{ default?: string, byAgent?: { [aircraftId]: string } }`; empty text means "not set".
 */
export function resolveProcedures(spec, aircraftIds, comlostAction) {
  if (spec != null && (typeof spec !== 'object' || Array.isArray(spec))) throw new TypeError('Procedures must be an object');
  if (spec?.byAgent != null && (typeof spec.byAgent !== 'object' || Array.isArray(spec.byAgent))) {
    throw new TypeError('Procedures byAgent must be an object keyed by aircraft id');
  }
  const ids = [...(aircraftIds ?? [])];
  const known = new Set(ids);
  const fallback = isSet(spec?.default)
    ? { steps: parseLabelled(spec.default, 'Default procedure'), source: 'default' }
    : { steps: defaultProcedure(comlostAction), source: 'rulebook' };
  const own = {};
  for (const [id, text] of Object.entries(spec?.byAgent ?? {})) {
    if (!known.has(id)) throw new Error(`Procedure for unknown aircraft ${id}`);
    if (text != null && typeof text !== 'string') throw new TypeError(`Procedure for ${id} must be text`);
    if (isSet(text)) own[id] = { steps: parseLabelled(text, `Procedure for ${id}`), source: 'agent' };
  }
  // Each aircraft gets its own copy so no two agents share mutable state.
  return Object.fromEntries(ids.map(id => {
    const procedure = own[id] ?? fallback;
    return [id, { steps: procedure.steps.map(step => ({ ...step })), source: procedure.source }];
  }));
}
