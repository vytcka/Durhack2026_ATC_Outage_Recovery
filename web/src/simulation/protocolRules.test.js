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

// Lost-comms block procedures. The destination ATC goes silent at 60 s; with the 60 s timeout
// the aircraft (airborne at 50 s) declares lost contact at 170 s.
test('a per-aircraft block procedure squawks, circles in place, then diverts to its origin', () => {
  const sim = new Simulation([flight], { airports, disruptions: [event('ATC_LINK_OUTAGE', 'atc:BBB')],
    procedures: { byAgent: { 'aircraft:0': 'Squawk = 7600\nCircleAround = 2\nDivert = ORIGIN' } } });
  assert.equal(sim.advanceTo(160_000).aircraft[0].procedureState, null);
  const circling = sim.advanceTo(200_000).aircraft[0];
  assert.equal(circling.procedure.source, 'agent');
  assert.equal(circling.squawk, '7600');
  assert.equal(circling.procedureState.active, true);
  assert.equal(circling.procedureState.command, 'CIRCLE');
  assert.equal(circling.procedureState.stepIndex, 1);
  assert.equal(circling.procedureState.startedAt, 170_000);
  assert.equal(circling.protocolDecision.trigger, 'COMLOST');
  assert.equal(circling.protocolDecision.action, 'PROCEDURE');
  assert.equal(sim.advanceTo(280_000).aircraft[0].progress, circling.progress, 'no route progress while circling');

  const diverting = sim.advanceTo(400_000).aircraft[0];
  assert.equal(diverting.diverted, true);
  assert.equal(diverting.arrivalAirport, 'AAA');
  assert.equal(diverting.diversion.trigger, 'COMLOST');
  assert.equal(diverting.diversion.action, 'RETURNTOORIGIN');
  assert.equal(diverting.procedureState.active, false);
  assert.equal(diverting.procedureState.outcome, 'diverting');
  assert.equal(diverting.squawk, null, 'the alternate answered, so the radio-failure code is cleared');
  const kinds = diverting.reasoning.map(entry => entry.kind);
  for (const kind of ['DEPARTED', 'CONTACT_LOST', 'PROCEDURE_STEP', 'ALTERNATE_CHOSEN', 'DIVERSION_STARTED']) {
    assert.ok(kinds.includes(kind), kind);
  }
  assert.ok(diverting.reasoning.every(entry => Number.isFinite(entry.at)));

  const landed = sim.advanceTo(600_000);
  assert.equal(landed.aircraft[0].phase, 'ARRIVED');
  assert.deepEqual(landed.aircraft[0].position, [0, 0]);
  sim.advanceTo(0);
  assert.deepEqual(sim.advanceTo(600_000), landed);
});

test('hearing the controller again stops the procedure and restores the transponder', () => {
  const sim = new Simulation([flight], { airports,
    disruptions: [{ ...event('ATC_LINK_OUTAGE', 'atc:BBB'), endMs: 220_000 }],
    procedures: { default: 'Squawk = 7600\nContinue = 10\nDivert = NEAREST' } });
  const lost = sim.advanceTo(200_000).aircraft[0];
  assert.equal(lost.procedure.source, 'default');
  assert.equal(lost.squawk, '7600');
  assert.equal(lost.procedureState.command, 'CONTINUE');
  const restored = sim.advanceTo(300_000).aircraft[0];
  assert.equal(restored.procedureState.active, false);
  assert.equal(restored.procedureState.outcome, 'contact-restored');
  assert.equal(restored.squawk, null);
  assert.equal(restored.diverted, false);
  assert.equal(restored.pendingAlternate, null, 'the Divert block was never reached');
  assert.ok(restored.reasoning.some(entry => entry.kind === 'CONTACT_RESTORED'));
});

test('a Hold block stops progress and a global outage still never authorises landing', () => {
  const state = new Simulation([flight], { airports, disruptions: [event('ATC_LINK_OUTAGE', undefined)],
    procedures: { default: 'Hold = 1\nDivert = NEAREST' } });
  const holding = state.advanceTo(200_000).aircraft[0];
  assert.equal(holding.procedureState.command, 'HOLD');
  assert.equal(state.advanceTo(220_000).aircraft[0].progress, holding.progress);
  const later = state.advanceTo(500_000).aircraft[0];
  assert.equal(later.procedureState.outcome, 'diverting');
  assert.equal(later.diverted, false, 'no alternate can answer through a network-wide outage');
  assert.notEqual(later.phase, 'ARRIVED');
});

test('invalid or misaddressed procedures are rejected when the simulation is built', () => {
  assert.throws(() => new Simulation([flight], { procedures: { byAgent: { 'aircraft:9': 'Relay' } } }), /unknown aircraft/);
  assert.throws(() => new Simulation([flight], { procedures: { default: 'Fly = home' } }), /Line 1: unknown block/);
});
