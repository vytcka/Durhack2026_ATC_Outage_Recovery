import test from 'node:test';
import assert from 'node:assert/strict';
import { DISRUPTION_FACTORS } from './factorCatalogue.js';
import { delayBreakdown, delayCauseLabel, describeReasoning, explainDiversion, formatDuration } from './reasoning.js';

test('delay causes are labelled from the factor catalogue or the synthetic causes', () => {
  assert.equal(delayCauseLabel('HEADWIND'), DISRUPTION_FACTORS.find(factor => factor.id === 'HEADWIND').label);
  assert.equal(delayCauseLabel('DETOUR'), 'Approved detour (longer route)');
  assert.equal(delayCauseLabel('DIVERSION'), 'Diversion leg');
  assert.equal(delayCauseLabel('LOST_CONTACT'), 'Lost-comms procedure');
  assert.equal(delayCauseLabel('PROTOCOL'), 'Message latency / retries');
  assert.equal(delayCauseLabel('SOMETHING_NEW'), 'something new');
});

test('the delay breakdown is scaled to the total delay, largest first, without zero causes', () => {
  const rows = delayBreakdown({ totalDelayMs: 600_000, delayByCause: { HEADWIND: 200_000, DETOUR: 600_000, PROTOCOL: 0 } });
  assert.deepEqual(rows.map(row => row.cause), ['DETOUR', 'HEADWIND']);
  assert.equal(rows[0].ms, 450_000);
  assert.equal(rows[0].share, 0.75);
  assert.equal(rows[1].ms, 150_000);
  assert.equal(rows.reduce((sum, row) => sum + row.ms, 0), 600_000);
  assert.deepEqual(delayBreakdown({ totalDelayMs: 5_000 }), [{ cause: 'UNATTRIBUTED', label: 'Not attributed yet', ms: 5_000, share: 1 }]);
  assert.deepEqual(delayBreakdown({ totalDelayMs: 0, delayByCause: { HEADWIND: 10 } }), []);
  assert.deepEqual(delayBreakdown(undefined), []);
});

test('durations read naturally', () => {
  assert.equal(formatDuration(45_000), '45 s');
  assert.equal(formatDuration(660_000), '11 min');
  assert.equal(formatDuration(65 * 60_000), '1 h 05 min');
  assert.equal(formatDuration(0), '0 s');
});

test('recorded decisions become sentences', () => {
  assert.equal(describeReasoning({ at: 170_000, kind: 'CONTACT_LOST', controller: 'atc:BBB', silenceMs: 120_000, source: 'agent' }),
    "No reply from BBB ATC for 2 min; started this aircraft's procedure.");
  assert.equal(describeReasoning({ kind: 'PROCEDURE_STEP', index: 1, step: { command: 'CIRCLE', minutes: 5 } }),
    'Procedure block 2: CircleAround = 5 (orbit in place for 5 min).');
  assert.equal(describeReasoning({ kind: 'ALTERNATE_CHOSEN', airport: 'IND', policy: 'LANDNEARESTAIRPORT', distanceNm: 90, excluded: ['DEN', 'ORD'] }),
    'Chose IND as the alternate (nearest open airport, 90 NM away; excluded DEN and ORD).');
  assert.equal(describeReasoning({ kind: 'DIVERSION_STARTED', airport: 'IND', previousAirport: 'DEN', legNm: 84, legMs: 660_000 }),
    'Diverted from DEN to IND: 84 NM straight leg, about 11 min.');
  assert.equal(describeReasoning({ kind: 'DESTINATION_CLOSED', airport: 'DEN' }, { nameOf: id => id.replace('atc:', 'Tower ') }),
    'Tower DEN reported DEN closed.');
  assert.equal(describeReasoning({ kind: 'MYSTERY_EVENT' }), 'mystery event');
});

test('a diversion is explained step by step', () => {
  const agent = {
    diverted: true,
    diversion: { airport: 'IND', previousAirport: 'DEN', trigger: 'DESTCLOSED', action: 'LANDNEARESTAIRPORT',
      startedAt: 8_040_000, durationMs: 660_000 },
    reasoning: [
      { at: 7_980_000, kind: 'DESTINATION_CLOSED', airport: 'DEN' },
      { at: 7_990_000, kind: 'ALTERNATE_CHOSEN', airport: 'IND', policy: 'LANDNEARESTAIRPORT', distanceNm: 90, excluded: ['DEN', 'ORD'] },
      { at: 8_040_000, kind: 'DIVERSION_STARTED', airport: 'IND', previousAirport: 'DEN', legNm: 84, legMs: 660_000 },
    ],
  };
  assert.deepEqual(explainDiversion(agent, { airport_dest: 'DEN' }), [
    'DEN reported closed at 02:13 (destination closed).',
    'Policy: nearest open airport; DEN (original destination) and ORD (closure reported) excluded.',
    'IND chosen: 84 NM from the turn point.',
    'Approved by IND ATC at 02:14; 11 min leg.',
  ]);
});

test('lost-contact diversions and pending alternates are explained too', () => {
  const lost = explainDiversion({
    diverted: true,
    diversion: { airport: 'AAA', previousAirport: 'BBB', trigger: 'COMLOST', action: 'RETURNTOORIGIN', startedAt: 310_000, durationMs: 110_000 },
    reasoning: [{ at: 170_000, kind: 'CONTACT_LOST', controller: 'atc:BBB', silenceMs: 120_000, source: 'agent' }],
  });
  assert.equal(lost[0], 'Lost contact with BBB ATC at 00:02; the lost-comms procedure ordered a diversion.');
  assert.equal(lost[1], 'Policy: return to origin; BBB (original destination) excluded.');
  assert.deepEqual(explainDiversion({ diverted: false, pendingAlternate: { airport: 'IND', action: 'LANDNEARESTAIRPORT' } }),
    ['Seeking an alternate (nearest open airport): asking IND.']);
  assert.deepEqual(explainDiversion({ diverted: false }), []);
});
