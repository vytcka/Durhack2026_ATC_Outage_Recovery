import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from './engine.js';

const flight = { aircraft_reg: 'M1', flight_number: 'M1', airport_dep: 'AAA', airport_dest: 'BBB',
  est_flight_dur: 10, origin: [0, 0], destination: [2, 0] };
const has = (comms, match) => comms.some(link => Object.entries(match).every(([key, value]) => link[key] === value));

test('comms shows the latest tick: messages in flight, delivered and dropped', () => {
  const sim = new Simulation([flight]);
  let state = sim.advanceTo(10_000);
  assert.ok(has(state.comms, { from: 'aircraft:0', to: 'atc:AAA', type: 'DEPARTURE_REQUEST', status: 'in-flight' }));
  state = sim.advanceTo(20_000);
  assert.ok(has(state.comms, { from: 'aircraft:0', to: 'atc:AAA', type: 'DEPARTURE_REQUEST', status: 'delivered' }));
  assert.ok(has(state.comms, { from: 'atc:AAA', to: 'aircraft:0', type: 'PLAN_OFFER', status: 'in-flight' }));
  assert.equal(state.aircraft[0].measures.sent, 1);

  const lossy = new Simulation([flight], { disruptions: [{ factor: 'PACKET_LOSS', startMs: 0, endMs: 600_000, value: 1 }] })
    .advanceTo(10_000);
  assert.ok(has(lossy.comms, { from: 'aircraft:0', type: 'DEPARTURE_REQUEST', status: 'dropped' }));
  assert.equal(lossy.aircraft[0].measures.dropped, 1);
});

test('delay growth is attributed to the factor that was active, and sums to the total delay', () => {
  const state = new Simulation([flight], { disruptions: [
    { id: 'wind', factor: 'HEADWIND', agentId: 'aircraft:0', startMs: 0, endMs: 600_000, value: 0.5 },
  ] }).advanceTo(400_000).aircraft[0];
  assert.ok(state.totalDelayMs > 0);
  assert.deepEqual(Object.keys(state.delayByCause), ['HEADWIND']);
  assert.equal(state.delayByCause.HEADWIND, state.totalDelayMs);
  assert.ok(state.measures.enRouteMs > 0);
});

test('holding at a no-go boundary is measured as hold time and blamed on the region', () => {
  const held = new Simulation([flight], { rulebook: 'NOGOREGION: HOLD', disruptions: [
    { factor: 'NO_GO_REGION', agentId: 'aircraft:0', startMs: 60_000, endMs: 300_000, value: 0.2 },
  ] }).advanceTo(290_000).aircraft[0];
  assert.ok(held.measures.holdMs >= 60_000);
  assert.ok(held.delayByCause.NO_GO_REGION > 0);
});

test('fleet statistics count detours and diversions, and measurements replay exactly', () => {
  const sim = new Simulation([flight, { ...flight, aircraft_reg: 'M2', flight_number: 'M2' }], { disruptions: [
    { factor: 'NO_GO_REGION', agentId: 'aircraft:0', startMs: 0, endMs: 600_000, value: 0.4 },
    { factor: 'AIRPORT_CLOSURE', agentId: 'atc:BBB', startMs: 200_000, endMs: 600_000, value: 1 },
  ] });
  const state = sim.advanceTo(500_000);
  assert.equal(state.stats.detouredFlights >= 1, true);
  assert.ok(state.stats.divertedFlights >= 1);
  assert.ok(state.stats.affectedFlights >= state.stats.divertedFlights);
  const total = state.aircraft.reduce((sum, agent) => sum + (agent.delayByCause.NO_GO_REGION ?? 0), 0);
  assert.equal(state.stats.delayByCause.NO_GO_REGION ?? 0, total);
  sim.advanceTo(0);
  assert.deepEqual(sim.advanceTo(500_000), state);
});
