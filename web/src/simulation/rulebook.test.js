import test from 'node:test';
import assert from 'node:assert/strict';

const load = () => import('./rulebook.js');

test('parses all supported actions case-insensitively and preserves rule order', async () => {
  const { parseRulebook } = await load();
  const supported = {
    COMLOST: ['CONTINUE', 'LANDNEARESTAIRPORT', 'RETURNTOORIGIN'],
    DESTCLOSED: ['LANDNEARESTAIRPORT', 'RETURNTOORIGIN'],
    NOGOREGION: ['DETOUR', 'HOLD'],
  };
  for (const [trigger, actions] of Object.entries(supported)) {
    for (const action of actions) {
      assert.deepEqual(parseRulebook(` # comment\r\n ${trigger.toLowerCase()} : ${action.toLowerCase()} \r\n`), [{ trigger, action }]);
    }
  }
  assert.deepEqual(parseRulebook('NOGOREGION: HOLD\n\nCOMLOST: CONTINUE'), [
    { trigger: 'NOGOREGION', action: 'HOLD' },
    { trigger: 'COMLOST', action: 'CONTINUE' },
  ]);
});

test('rejects malformed syntax with original line numbers', async () => {
  const { parseRulebook } = await load();
  for (const line of ['COMLOST CONTINUE', 'COMLOST:', ': CONTINUE', 'COMLOST: CONTINUE: HOLD', 'COMLOST: CONTINUE # note', 'COMLOST: CONTINUE; alert(1)']) {
    assert.throws(() => parseRulebook(`# comment\n\n${line}`), /Line 3:.*TRIGGER: ACTION/i);
  }
});

test('rejects unknown triggers and actions with actionable line errors', async () => {
  const { parseRulebook } = await load();
  assert.throws(() => parseRulebook('\nWEATHER: HOLD'), /Line 2:.*unknown trigger.*WEATHER.*COMLOST/i);
  assert.throws(() => parseRulebook('# note\nCOMLOST: EXPLODE'), /Line 2:.*unknown action.*EXPLODE.*COMLOST.*CONTINUE/i);
  assert.throws(() => parseRulebook('DESTCLOSED: CONTINUE'), /Line 1:.*unknown action.*CONTINUE.*DESTCLOSED/i);
  assert.throws(() => parseRulebook('NOGOREGION: RETURNTOORIGIN'), /Line 1:.*unknown action.*DETOUR.*HOLD/i);
  // Object prototype names must not become accepted trigger keys.
  assert.throws(() => parseRulebook('__proto__: HOLD'), /Line 1:.*unknown trigger/i);
});

test('rejects duplicate triggers case-insensitively and identifies both lines', async () => {
  const { parseRulebook } = await load();
  assert.throws(() => parseRulebook('COMLOST: CONTINUE\n# note\ncomlost: RETURNTOORIGIN'), /Line 3:.*duplicate.*COMLOST.*line 1/i);
});

test('bounds input to 4096 characters and 20 physical lines including comments', async () => {
  const { parseRulebook } = await load();
  assert.deepEqual(parseRulebook('#' + 'x'.repeat(4095)), []);
  assert.throws(() => parseRulebook('#' + 'x'.repeat(4096)), /Line 1:.*4096.*character/i);
  assert.deepEqual(parseRulebook(Array(20).fill('# comment').join('\n')), []);
  assert.throws(() => parseRulebook(Array(21).fill('# comment').join('\n')), /Line 21:.*20.*line/i);
  assert.throws(() => parseRulebook(Array(21).fill('').join('\r\n')), /Line 21:.*20.*line/i);
});

test('rejects non-text inputs rather than coercing executable objects', async () => {
  const { parseRulebook } = await load();
  for (const value of [undefined, null, {}, [], 42]) {
    assert.throws(() => parseRulebook(value), /Line 1:.*text/i);
  }
});

test('empty rulebooks preserve default policy', async () => {
  await assert.doesNotReject(load, 'The parser module must exist');
  const { parseRulebook } = await load();
  assert.deepEqual(parseRulebook(''), []);
  assert.deepEqual(parseRulebook('  \n# use defaults\n\t'), []);
});
