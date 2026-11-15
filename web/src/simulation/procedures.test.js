import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROCEDURE_BLOCKS, PROCEDURE_COMMANDS, PROCEDURE_MAX_COMMANDS, SUGGESTED_PROCEDURE_TEXT,
  defaultProcedure, defaultStep, formatProcedure, parseProcedure, resolveProcedures, tokenizeProcedure,
} from './procedures.js';

test('blocks parse as Name = value, Name value or bare, ignoring case, spaces and underscores', () => {
  assert.deepEqual(parseProcedure('Squawk = 7600\ncircle_around 30\nCIRCLE AROUND = 5\nRelay\nhold=2\nContinue 4\nDivert = ind'), [
    { command: 'SQUAWK', code: '7600' },
    { command: 'CIRCLE', minutes: 30 },
    { command: 'CIRCLE', minutes: 5 },
    { command: 'RELAY' },
    { command: 'HOLD', minutes: 2 },
    { command: 'CONTINUE', minutes: 4 },
    { command: 'DIVERT', target: 'IND' },
  ]);
});

test('bare parameter blocks use their palette default', () => {
  assert.deepEqual(parseProcedure('Squawk\nContinue\nCircleAround\nDivert'), [
    { command: 'SQUAWK', code: '7600' },
    { command: 'CONTINUE', minutes: 3 },
    { command: 'CIRCLE', minutes: 5 },
    { command: 'DIVERT', target: 'NEAREST' },
  ]);
});

test('the tokenizer splits lines into name and value without validating them', () => {
  assert.deepEqual(tokenizeProcedure('# comment\n\nHold = 2\nFoo bar\nCircle Around 30\nRelay ='), [
    { line: 3, name: 'Hold', value: '2', raw: 'Hold = 2' },
    { line: 4, name: 'Foo', value: 'bar', raw: 'Foo bar' },
    { line: 5, name: 'Circle Around', value: '30', raw: 'Circle Around 30' },
    { line: 6, name: 'Relay', value: null, raw: 'Relay =' },
  ]);
  assert.deepEqual(tokenizeProcedure(42), []);
});

test('invalid procedures name the offending line', () => {
  assert.throws(() => parseProcedure('Squawk = 7600\nJump = 3'), /^Error: Line 2: unknown block "Jump"/);
  assert.throws(() => parseProcedure('Squawk = 9999'), /Line 1: Squawk takes four octal digits/);
  assert.throws(() => parseProcedure('Hold = 31'), /Line 1: Hold takes a whole number of minutes from 1 to 30/);
  assert.throws(() => parseProcedure('Continue = 2.5'), /Line 1: Continue takes a whole number of minutes/);
  assert.throws(() => parseProcedure('CircleAround = 0'), /Line 1: CircleAround takes a whole number of minutes from 1 to 60/);
  assert.throws(() => parseProcedure('Relay = 3'), /Line 1: Relay takes no value/);
  assert.throws(() => parseProcedure('Divert = MOON'), /Line 1: Divert takes NEAREST, ORIGIN or a three-letter airport code/);
  assert.throws(() => parseProcedure('Divert = NEAREST\nHold = 2'), /Line 2: Divert ends the procedure/);
  assert.throws(() => parseProcedure(Array.from({ length: PROCEDURE_MAX_COMMANDS + 1 }, () => 'Relay').join('\n')),
    /Line 13: a procedure has at most 12 blocks/);
  assert.throws(() => parseProcedure('#'.repeat(1025)), /exceeds 1024 characters/);
  assert.throws(() => parseProcedure('\n'.repeat(41)), /Line 41: procedure exceeds 40 lines/);
  assert.throws(() => parseProcedure(null), TypeError);
  assert.deepEqual(parseProcedure('# only a comment\n\n'), []);
});

test('formatting writes the canonical Name = value form and round-trips', () => {
  assert.equal(SUGGESTED_PROCEDURE_TEXT, 'Squawk = 7600\nContinue = 3\nRelay\nCircleAround = 5\nDivert = NEAREST');
  assert.equal(formatProcedure(parseProcedure(SUGGESTED_PROCEDURE_TEXT)), SUGGESTED_PROCEDURE_TEXT);
  assert.equal(formatProcedure([{ command: 'CIRCLE', minutes: 30 }, { command: 'RELAY' }]), 'CircleAround = 30\nRelay');
  assert.equal(formatProcedure(parseProcedure('circle around 12\ndivert ind')), 'CircleAround = 12\nDivert = IND');
});

test('every palette block is complete and its default step is valid', () => {
  assert.equal(PROCEDURE_COMMANDS.length, PROCEDURE_BLOCKS.length);
  for (const block of PROCEDURE_BLOCKS) {
    for (const field of ['id', 'label', 'command', 'color', 'description']) assert.ok(block[field], `${block.id}.${field}`);
    assert.ok(!block.description.includes('\n'), `${block.id} description is one line`);
    const text = formatProcedure([defaultStep(block)]);
    assert.deepEqual(parseProcedure(text), [defaultStep(block)], block.id);
  }
});

test('engine defaults follow the rulebook COMLOST action', () => {
  const squawk = { command: 'SQUAWK', code: '7600' };
  assert.deepEqual(defaultProcedure(), [squawk]);
  assert.deepEqual(defaultProcedure('CONTINUE'), [squawk]);
  assert.deepEqual(defaultProcedure('LANDNEARESTAIRPORT'), [squawk, { command: 'DIVERT', target: 'NEAREST' }]);
  assert.deepEqual(defaultProcedure('RETURNTOORIGIN'), [squawk, { command: 'DIVERT', target: 'ORIGIN' }]);
});

test('each aircraft resolves its own procedure, then the shared default, then the rulebook', () => {
  const ids = ['aircraft:0', 'aircraft:1', 'aircraft:2'];
  const none = resolveProcedures(undefined, ids, 'RETURNTOORIGIN');
  assert.deepEqual(none['aircraft:0'], { steps: defaultProcedure('RETURNTOORIGIN'), source: 'rulebook' });

  const resolved = resolveProcedures({ default: 'Squawk = 7600\nHold = 2', byAgent: { 'aircraft:1': 'Divert = ORIGIN', 'aircraft:2': '  ' } }, ids);
  assert.deepEqual(resolved['aircraft:0'], { steps: [{ command: 'SQUAWK', code: '7600' }, { command: 'HOLD', minutes: 2 }], source: 'default' });
  assert.deepEqual(resolved['aircraft:1'], { steps: [{ command: 'DIVERT', target: 'ORIGIN' }], source: 'agent' });
  assert.equal(resolved['aircraft:2'].source, 'default', 'blank text means not set');
  assert.notEqual(resolved['aircraft:0'].steps, resolved['aircraft:2'].steps, 'no shared step arrays between aircraft');

  assert.equal(resolveProcedures({ default: '' }, ids)['aircraft:0'].source, 'rulebook');
  assert.throws(() => resolveProcedures({ byAgent: { 'aircraft:9': 'Relay' } }, ids), /unknown aircraft aircraft:9/);
  assert.throws(() => resolveProcedures({ byAgent: { 'aircraft:1': 'Jump' } }, ids), /Procedure for aircraft:1: Line 1: unknown block/);
  assert.throws(() => resolveProcedures({ default: 'Hold = 99' }, ids), /Default procedure: Line 1/);
  assert.throws(() => resolveProcedures('Relay', ids), TypeError);
});
