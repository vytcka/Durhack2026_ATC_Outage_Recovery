import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from './engine.js';

const flight = { aircraft_reg: 'RULE1', flight_number: 'RULE1', airport_dep: 'AAA', airport_dest: 'BBB',
  est_flight_dur: 10, origin: [0, 0], destination: [10, 0] };
const airports = [{ iata: 'AAA', lon: 0, lat: 0 }, { iata: 'BBB', lon: 10, lat: 0 }, { iata: 'CCC', lon: 1, lat: 0.1 }];
const event = (factor, agentId, value = 1) => ({ factor, agentId, value, startMs: 60_000, endMs: 600_000 });

test('COMLOST nearest-airport rule uses a local timeout, negotiates a real alternate and lands there', () => {
  const sim = new Simulation([flight], { airports, rulebook: 'COMLOST: LANDNEARESTAIRPORT',
    disruptions: [event('ATC_LINK_OUTAGE', 'atc:BBB')] });
  assert.equal(sim.advanceTo(90_000).aircraft[0].protocolDecision, null);
  const state = sim.advanceTo(240_000);
  assert.equal(state.aircraft[0].protocolDecision.trigger, 'COMLOST');
  assert.equal(state.aircraft[0].protocolDecision.action, 'LANDNEARESTAIRPORT');
  assert.equal(state.aircraft[0].arrivalAirport, 'CCC');
  assert.equal(state.aircraft[0].diversion.airport, 'CCC');
  assert.ok(state.events.some(item => item.type === 'RULE_TRIGGERED'));
  const landed = sim.advanceTo(600_000);
  assert.equal(landed.aircraft[0].phase, 'ARRIVED');
  assert.deepEqual(landed.aircraft[0].position, [1, 0.1]);
  sim.advanceTo(0);
  assert.deepEqual(sim.advanceTo(600_000), landed);
});

test('COMLOST never authorises landing when every ATC link is unavailable', () => {
  const state = new Simulation([flight], { airports, rulebook: 'COMLOST: LANDNEARESTAIRPORT',
    disruptions: [event('ATC_LINK_OUTAGE', undefined)] }).advanceTo(400_000);
  assert.equal(state.aircraft[0].protocolDecision?.trigger, 'COMLOST');
  assert.equal(state.aircraft[0].diverted, false);
  assert.notEqual(state.aircraft[0].phase, 'ARRIVED');
});

test('DESTCLOSED chooses nearest locally known alternate and avoids communicated closures', () => {
  const sim = new Simulation([flight], { airports, rulebook: 'DESTCLOSED: LANDNEARESTAIRPORT',
    disruptions: [event('AIRPORT_CLOSURE', 'atc:BBB'), event('AIRPORT_CLOSURE', 'atc:CCC')] });
  const landed = sim.advanceTo(600_000);
  assert.equal(landed.aircraft[0].arrivalAirport, 'AAA');
  assert.equal(landed.aircraft[0].phase, 'ARRIVED');
  assert.equal(landed.aircraft[0].protocolDecision.trigger, 'DESTCLOSED');
});

test('NOGOREGION HOLD overrides the default detour policy and exposes current factors', () => {
  const sim = new Simulation([flight], { rulebook: 'NOGOREGION: HOLD',
    disruptions: [{ ...event('NO_GO_REGION', 'aircraft:0', 0.2), endMs: 300_000 }] });
  const held = sim.advanceTo(240_000).aircraft[0];
  assert.equal(held.reroute, null);
  assert.ok(held.progress <= 0.2);
  assert.equal(held.protocolDecision.action, 'HOLD');
  assert.ok(held.activeFactors.some(item => item.factor === 'NO_GO_REGION'));
  assert.equal(sim.advanceTo(900_000).stats.arrived, 1);
});

test('COMLOST CONTINUE records the decision without diverting', () => {
  const state = new Simulation([flight], { airports, rulebook: 'COMLOST: CONTINUE',
    disruptions: [event('ATC_LINK_OUTAGE', 'atc:BBB')] }).advanceTo(240_000);
  assert.equal(state.aircraft[0].protocolDecision.action, 'CONTINUE');
  assert.equal(state.aircraft[0].diverted, false);
});
