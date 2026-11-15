import test from 'node:test';
import assert from 'node:assert/strict';
import { AUTO_DISRUPTION_LEVELS, generateAutoDisruptions } from './autoDisruptions.js';
import { DISRUPTION_FACTORS } from './factorCatalogue.js';
import { Simulation } from './engine.js';
import { SIMULATION_MS } from './timing.js';

// Five airports on a line; every airport keeps one coordinate across flights.
const AIRPORTS = ['AAA', 'BBB', 'CCC', 'DDD', 'EEE'];
const position = index => [index * 2, index % 2];
const flights = Array.from({ length: 30 }, (_, index) => ({
  aircraft_reg: `N${index}`, flight_number: `T${index}`,
  airport_dep: AIRPORTS[index % 5], airport_dest: AIRPORTS[(index + 2) % 5],
  est_flight_dur: 45 + (index % 4) * 20,
  departure_time: `0${Math.floor(index / 6)}:${String((index % 6) * 10).padStart(2, '0')}`,
  origin: position(index % 5), destination: position((index + 2) % 5),
}));
const FACTOR = Object.fromEntries(DISRUPTION_FACTORS.map(factor => [factor.id, factor]));

test('levels are listed and "off" or an empty fleet generates nothing', () => {
  assert.deepEqual(AUTO_DISRUPTION_LEVELS.map(level => level.id), ['off', 'light', 'moderate', 'heavy']);
  assert.deepEqual(generateAutoDisruptions(flights, { seed: 1, level: 'off' }), []);
  assert.deepEqual(generateAutoDisruptions([], { seed: 1, level: 'heavy' }), []);
});

test('generation is deterministic per seed and grows with the level', () => {
  const moderate = generateAutoDisruptions(flights, { seed: 42, level: 'moderate' });
  assert.deepEqual(generateAutoDisruptions(flights, { seed: 42, level: 'moderate' }), moderate);
  assert.notDeepEqual(generateAutoDisruptions(flights, { seed: 7, level: 'moderate' }), moderate);
  const light = generateAutoDisruptions(flights, { seed: 42, level: 'light' });
  const heavy = generateAutoDisruptions(flights, { seed: 42, level: 'heavy' });
  assert.ok(light.length < moderate.length && moderate.length < heavy.length);
  for (const factor of ['NO_GO_REGION', 'HEADWIND', 'AIRPORT_CLOSURE', 'ATC_LINK_OUTAGE', 'RUNWAY_CLOSURE']) {
    assert.ok(heavy.some(event => event.factor === factor), `heavy level includes ${factor}`);
  }
});

test('every generated event satisfies the engine contract', () => {
  for (const level of ['light', 'moderate', 'heavy']) {
    const events = generateAutoDisruptions(flights, { seed: 3, level });
    assert.equal(new Set(events.map(event => event.id)).size, events.length, 'unique ids');
    for (const event of events) {
      const factor = FACTOR[event.factor];
      assert.ok(factor, `${event.factor} is a catalogue factor`);
      assert.equal(event.source, 'auto');
      assert.equal(typeof event.label, 'string');
      assert.ok(event.startMs >= 0 && event.endMs > event.startMs && event.endMs <= SIMULATION_MS);
      assert.ok(event.value >= factor.min && event.value <= factor.max, `${event.id} value in bounds`);
      if (factor.step >= 1) assert.ok(Number.isInteger(event.value));
      if (event.agentId) {
        const kind = event.agentId.startsWith('atc:') ? 'atc' : 'aircraft';
        assert.ok(factor.targetKinds.includes(kind), `${event.id} targets a valid ${kind}`);
      }
    }
    // The engine's own validation is the real check: construction must not throw.
    assert.doesNotThrow(() => new Simulation(flights, { disruptions: events }));
  }
});

test('a heavy background scenario produces measured detours and delays without any manual event', () => {
  const disruptions = generateAutoDisruptions(flights, { seed: 42, level: 'heavy' });
  const state = new Simulation(flights, { disruptions }).advanceTo(8 * 3_600_000);
  assert.ok(state.stats.detouredFlights > 0, 'storm cells force approved detours');
  assert.ok(state.stats.affectedFlights > 0);
  assert.ok(Object.keys(state.stats.delayByCause).length > 0, 'delay is attributed to causes');
});
