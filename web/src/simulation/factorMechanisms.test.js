import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from './engine.js';

const flights = [0, 1].map(index => ({
  aircraft_reg: `N${index}`, flight_number: `F${index}`, airport_dep: 'AAA', airport_dest: 'BBB',
  est_flight_dur: 2, fuel_remaining: 1000, origin: [0, 0], destination: [2, 0],
}));
const event = (factor, value, extra = {}) => ({ factor, value, startMs: 0, endMs: 600_000, ...extra });

test('transport disruptions have distinct loss, rejection, duplication and queuing effects', () => {
  for (const [factor, value] of [['ONE_WAY_FAILURE', 2], ['LOST_ACK', 1]]) {
    const state = new Simulation(flights, { disruptions: [event(factor, value)] }).advanceTo(120_000);
    assert.equal(state.stats.airborne, 0, factor);
    assert.ok(state.stats.dropped > 0, factor);
  }
  const corrupt = new Simulation(flights, { disruptions: [event('CORRUPTED_PAYLOAD', 1)] }).advanceTo(120_000);
  assert.equal(corrupt.stats.airborne, 0);
  assert.ok(corrupt.stats.rejected > 0);
  const duplicates = new Simulation(flights, { disruptions: [event('DUPLICATE_MESSAGE', 1)] }).advanceTo(400_000);
  assert.equal(duplicates.stats.arrived, 2);
  assert.ok(duplicates.stats.duplicates > 0);
  const bandwidth = new Simulation(flights, { disruptions: [event('BANDWIDTH_LIMIT', 1)] }).advanceTo(400_000);
  assert.ok(bandwidth.stats.bandwidthDeferred > 0);
  assert.ok(bandwidth.stats.disruptedFlights > 0);
});

test('perception and decision faults affect actual agent decisions, not just a label', () => {
  for (const [factor, value] of [['STALE_POSITION', 120_000], ['CLOCK_OFFSET', 120_000], ['POSITION_BIAS', 0.25]]) {
    const state = new Simulation(flights, { disruptions: [event(factor, value)] }).advanceTo(120_000);
    assert.equal(state.stats.airborne, 0, factor);
    assert.ok(state.stats.rejected > 0, factor);
  }
  const thinking = new Simulation(flights, { disruptions: [event('DECISION_DELAY', 60_000)] }).advanceTo(400_000);
  assert.ok(thinking.stats.totalDelayMs > 0);
  const climb = new Simulation(flights, { disruptions: [event('REDUCED_CLIMB', 0.5)] }).advanceTo(120_000);
  assert.ok(climb.aircraft[0].climbProgress < 1);
  assert.ok(climb.aircraft[0].travelDelayMs > 0);
  const wind = new Simulation(flights, { disruptions: [event('HEADWIND', 0.5)] }).advanceTo(400_000);
  assert.ok(wind.stats.totalDelayMs > 0);
});

test('airport resources queue requests, reopen and support explicit closure recovery', () => {
  for (const factor of ['RUNWAY_CLOSURE', 'AIRPORT_CLOSURE', 'CROSSWIND']) {
    const sim = new Simulation(flights, { disruptions: [event(factor, factor === 'CROSSWIND' ? 0.8 : 1, { endMs: 120_000 })] });
    assert.equal(sim.advanceTo(110_000).stats.airborne, 0, factor);
    assert.equal(sim.advanceTo(600_000).stats.arrived, 2, factor);
  }
  for (const [factor, value] of [['ARRIVAL_CAPACITY', 1], ['ATC_BACKLOG', 1], ['DEMAND_SURGE', 12]]) {
    const state = new Simulation(flights, { disruptions: [event(factor, value)] }).advanceTo(600_000);
    assert.ok(state.stats.totalDelayMs > 0, factor);
  }
});

test('peer outages affect actual reports and a relay can bypass a targeted ATC link failure', () => {
  const healthy = new Simulation(flights).advanceTo(120_000);
  const blocked = new Simulation(flights, { disruptions: [event('AIRCRAFT_LINK_OUTAGE', 1)] }).advanceTo(120_000);
  assert.equal(healthy.aircraft[0].knownPeers, 1);
  assert.equal(blocked.aircraft[0].knownPeers, 0);
  assert.ok(blocked.stats.dropped > 0);
  const relayed = new Simulation(flights, { disruptions: [event('ATC_LINK_OUTAGE', 1, { agentId: 'aircraft:0' })] }).advanceTo(400_000);
  assert.ok(relayed.aircraft[0].departedAt > 0 && relayed.aircraft[0].departedAt < 600_000);
  assert.ok(relayed.events.some(item => item.messageType === 'RELAY_UP'));
});

test('handover failure and route exclusion cause recoverable holds rather than failure', () => {
  for (const [factor, value] of [['HANDOVER_FAILURE', 1], ['NO_GO_REGION', 0.4]]) {
    const sim = new Simulation(flights, { disruptions: [event(factor, value, { endMs: 300_000 })] });
    const held = sim.advanceTo(240_000);
    assert.equal(held.stats.arrived, 0, factor);
    assert.ok(held.stats.totalDelayMs > 0, factor);
    assert.equal(sim.advanceTo(600_000).stats.arrived, 2, factor);
  }
});

test('reboot clears ATC memory once and retransmission recovers deterministically', () => {
  const sim = new Simulation(flights, { disruptions: [event('ATC_RESTART', 60_000,
    { agentId: 'atc:AAA', startMs: 30_000, endMs: 120_000 })] });
  const state = sim.advanceTo(600_000);
  assert.equal(state.stats.restarts, 1);
  assert.equal(state.stats.arrived, 2);
  assert.ok(state.stats.totalDelayMs > 0);
  sim.advanceTo(0);
  assert.deepEqual(sim.advanceTo(600_000), state);
});

test('reserve consumption requests priority and emergency arrivals precede normal arrivals', () => {
  const healthy = new Simulation(flights).advanceTo(120_000);
  const hungry = new Simulation(flights, { disruptions: [event('FUEL_CONSUMPTION', 3)] }).advanceTo(120_000);
  assert.ok(hungry.aircraft[0].reserve < healthy.aircraft[0].reserve);
  assert.equal(hungry.aircraft[0].priority, true);
  const priority = new Simulation(flights, { disruptions: [event('EMERGENCY_PRIORITY', 1, { agentId: 'aircraft:1' })] }).advanceTo(400_000);
  assert.ok(priority.aircraft[1].arrivedAt < priority.aircraft[0].arrivedAt);
});

test('airport closure negotiates an alternate and alternate capacity queues that shared resource', () => {
  const closure = event('AIRPORT_CLOSURE', 1, { agentId: 'atc:BBB', startMs: 60_000 });
  const normal = new Simulation(flights, { disruptions: [closure] }).advanceTo(600_000);
  assert.equal(normal.stats.arrived, 2);
  assert.equal(normal.aircraft[0].diverted, true);
  assert.equal(normal.aircraft[0].arrivalAirport, 'AAA');
  assert.equal(normal.aircraft[0].progress, 0);
  const constrained = new Simulation(flights, { disruptions: [closure,
    event('ALTERNATE_CAPACITY', 1, { agentId: 'atc:AAA' })] }).advanceTo(600_000);
  assert.ok(constrained.stats.totalDelayMs > normal.stats.totalDelayMs);
});

test('reduced radio reach blocks an otherwise reachable long-route arrival', () => {
  const distant = [{ ...flights[0], destination: [10, 0] }];
  const state = new Simulation(distant, { disruptions: [event('OBSERVATION_RANGE', 0.001)] }).advanceTo(400_000);
  assert.equal(state.stats.arrived, 0);
  assert.ok(state.stats.dropped > 0);
  assert.ok(state.stats.totalDelayMs > 0);
});

test('out-of-order jitter is seeded, changes delivery order and replays identically', () => {
  const sim = new Simulation(flights, { seed: 7, disruptions: [event('OUT_OF_ORDER', 60_000)] });
  const state = sim.advanceTo(400_000);
  const ids = state.events.filter(item => item.type === 'MESSAGE_DELIVERED').map(item => Number(item.messageId.split(':')[1]));
  assert.ok(ids.some((id, index) => index > 0 && id < ids[index - 1]));
  sim.advanceTo(0);
  assert.deepEqual(sim.advanceTo(400_000), state);
});
