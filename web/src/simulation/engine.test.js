import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from './engine.js';
import { DISRUPTION_FACTORS } from './disruptions.js';
import * as timing from './timing.js';

const flights = [
  { aircraft_reg: 'N1', flight_number: 'F1', airport_dep: 'AAA', airport_dest: 'BBB', est_flight_dur: 2 },
  { aircraft_reg: 'N2', flight_number: 'F2', airport_dep: 'AAA', airport_dest: 'BBB', est_flight_dur: 3 },
];

test('aircraft negotiate through delayed messages before departing', () => {
  const sim = new Simulation(flights);
  let state = sim.snapshot();
  assert.equal(state.aircraft.length, 2);
  assert.equal(state.stats.atcAgents, 2);
  assert.equal(state.stats.airborne, 0);
  sim.advanceTo(10_000);
  state = sim.snapshot();
  assert.equal(state.aircraft[0].phase, 'REQUESTING_DEPARTURE');
  assert.equal(state.stats.delivered, 0, 'new messages cannot arrive in the same tick');
  sim.advanceTo(40_000);
  assert.equal(sim.snapshot().stats.airborne, 0, 'an offer alone cannot permit departure');
  sim.advanceTo(50_000);
  state = sim.snapshot();
  assert.equal(state.stats.airborne, 2);
  assert.equal(state.aircraft[0].phase, 'EN_ROUTE');
  assert.ok(state.events.some(event => event.type === 'DEPARTURE_CONFIRMED'));
});

test('an ATC outage blocks departure, retries, then recovers without duplicate takeoffs', () => {
  const sim = new Simulation(flights, { disruptions: [
    { factor: 'ATC_LINK_OUTAGE', startMs: 0, endMs: 120_000 },
  ] });
  const blocked = sim.advanceTo(110_000);
  assert.equal(blocked.stats.airborne, 0);
  assert.ok(blocked.stats.dropped > 0);
  assert.ok(blocked.stats.timeouts > 0);
  const recovered = sim.advanceTo(180_000);
  assert.equal(recovered.stats.airborne, 2);
  assert.equal(recovered.aircraft[0].departedAt, 170_000);
});

test('complete packet loss prevents departure until the event ends', () => {
  const sim = new Simulation(flights, { seed: 7, disruptions: [
    { factor: 'PACKET_LOSS', startMs: 0, endMs: 120_000, value: 1 },
  ] });
  assert.equal(sim.advanceTo(110_000).stats.airborne, 0);
  assert.equal(sim.advanceTo(180_000).stats.airborne, 2);
});

test('additional latency delays the handshake without authorising an early departure', () => {
  const sim = new Simulation(flights, { timeoutMs: 300_000, disruptions: [
    { factor: 'DELIVERY_DELAY', startMs: 0, endMs: 600_000, value: 20_000 },
  ] });
  assert.equal(sim.advanceTo(120_000).stats.airborne, 0);
  assert.equal(sim.advanceTo(130_000).stats.airborne, 2);
});

test('rewinding restores private state and supports deterministic forward playback', () => {
  const options = { seed: 19, disruptions: [
    { factor: 'PACKET_LOSS', startMs: 0, endMs: 600_000, value: 0.25 },
  ] };
  const sim = new Simulation(flights, options);
  const expected = new Simulation(flights, options).advanceTo(300_000);
  sim.advanceTo(600_000);
  sim.advanceTo(0);
  assert.equal(sim.snapshot().time, 0);
  assert.deepEqual(sim.advanceTo(300_000), expected);
});

test('a disconnected aircraft follows its plan but waits for arrival approval', () => {
  const sim = new Simulation([flights[0]], { disruptions: [
    { factor: 'ATC_LINK_OUTAGE', startMs: 60_000, endMs: 300_000 },
  ] });
  const enRoute = sim.advanceTo(120_000);
  assert.equal(enRoute.aircraft[0].phase, 'EN_ROUTE');
  assert.ok(enRoute.aircraft[0].progress > 0);
  const holding = sim.advanceTo(240_000);
  assert.equal(holding.aircraft[0].phase, 'AWAITING_ARRIVAL');
  assert.equal(holding.stats.arrived, 0);
  const recovered = sim.advanceTo(400_000);
  assert.equal(recovered.aircraft[0].phase, 'ARRIVED');
  assert.equal(recovered.stats.arrived, 1);
});

test('snapshots and caller-owned inputs cannot mutate private agent state', () => {
  const input = structuredClone(flights);
  const sim = new Simulation(input);
  input[0].airport_dest = 'BAD';
  const state = sim.advanceTo(50_000);
  state.aircraft[0].plan.route[1] = 'BAD';
  state.aircraft[0].progress = 1;
  assert.equal(sim.snapshot().aircraft[0].plan.route[1], 'BBB');
  assert.equal(sim.snapshot().aircraft[0].progress, 0);
});

test('unsupported disruptions and invalid timing are rejected rather than silently ignored', () => {
  assert.throws(() => new Simulation(flights, { disruptions: [
    { factor: 'UNKNOWN_FACTOR', startMs: 0, endMs: 60_000 },
  ] }), /not implemented/);
  assert.throws(() => new Simulation(flights, { latencyMs: NaN }), /latencyMs/);
  assert.throws(() => new Simulation(flights, { timeoutMs: 0 }), /timeoutMs/);
  assert.throws(() => new Simulation(flights, { disruptions: [
    { factor: 'PACKET_LOSS', startMs: 0, endMs: 60_000, value: 2 },
  ] }), /probability/);
});

test('all thirty factors have distinct identifiers and implemented mechanisms', () => {
  assert.equal(DISRUPTION_FACTORS.length, 30);
  assert.equal(new Set(DISRUPTION_FACTORS.map(factor => factor.id)).size, 30);
  assert.equal(DISRUPTION_FACTORS.filter(factor => factor.implemented).length, 30);
});

test('duplicate aircraft registrations remain separate journey agents', () => {
  const sim = new Simulation([flights[0], flights[0]]);
  const state = sim.advanceTo(50_000);
  assert.equal(new Set(state.aircraft.map(agent => agent.id)).size, 2);
  assert.equal(new Set(state.aircraft.map(agent => agent.plan.id)).size, 2);
  assert.equal(state.stats.airborne, 2);
});

test('chunked playback and a direct seek produce the same results and message accounting', () => {
  const options = { seed: 42, disruptions: [
    { factor: 'PACKET_LOSS', startMs: 0, endMs: 600_000, value: 0.5 },
    { factor: 'DELIVERY_DELAY', startMs: 0, endMs: 600_000, value: 20_000 },
  ] };
  const direct = new Simulation(flights, options).advanceTo(600_000);
  const incremental = new Simulation(flights, options);
  for (let time = 0; time <= 600_000; time += 10_000) incremental.advanceTo(time);
  const state = incremental.snapshot();
  assert.deepEqual(state, direct);
  assert.equal(state.stats.sent, state.stats.delivered + state.stats.dropped + state.stats.queued);
  assert.ok(state.events.length <= 100);
});

test('healthy flights have a fixed expected arrival and no disruption delay', () => {
  const sim = new Simulation([flights[0]]);
  const initial = sim.snapshot();
  assert.equal(initial.aircraft[0].expectedArrivalAt, 190_000);
  const landed = sim.advanceTo(240_000);
  assert.equal(landed.aircraft[0].arrivedAt, 190_000);
  assert.equal(landed.aircraft[0].totalDelayMs, 0);
  assert.equal(landed.stats.disruptedFlights, 0);
});

test('departure delays count each affected flight once and remain recorded after landing', () => {
  const sim = new Simulation([flights[0]], { disruptions: [
    { factor: 'ATC_LINK_OUTAGE', startMs: 0, endMs: 120_000 },
  ] });
  const waiting = sim.advanceTo(110_000);
  assert.equal(waiting.stats.disruptedFlights, 1);
  assert.equal(waiting.aircraft[0].departureDelayMs, 60_000);
  const landed = sim.advanceTo(400_000);
  const agent = landed.aircraft[0];
  assert.equal(agent.phase, 'ARRIVED');
  assert.equal(agent.expectedArrivalAt, 190_000, 'baseline must not move with the delayed departure');
  assert.equal(agent.departureDelayMs, 120_000);
  assert.equal(agent.totalDelayMs, agent.arrivedAt - agent.expectedArrivalAt);
  assert.equal(landed.stats.disruptedFlights, 1);
  assert.equal(landed.stats.delayedArrivals, 1);
  assert.equal(landed.stats.currentlyDelayed, 0);
  assert.equal(landed.stats.totalDelayMs, agent.totalDelayMs);
  assert.deepEqual(sim.advanceTo(600_000).aircraft[0], agent);
});

test('reduced speed creates travel delay without stopping the aircraft', () => {
  const sim = new Simulation([flights[0]], { disruptions: [
    { factor: 'REDUCED_SPEED', startMs: 0, endMs: 600_000, value: 0.5 },
  ] });
  const early = sim.advanceTo(120_000).aircraft[0];
  const later = sim.advanceTo(180_000).aircraft[0];
  assert.equal(later.phase, 'EN_ROUTE');
  assert.ok(later.progress > early.progress);
  assert.ok(later.travelDelayMs > 0);
  const state = sim.advanceTo(400_000);
  const agent = state.aircraft[0];
  assert.equal(agent.phase, 'ARRIVED');
  assert.equal(agent.travelDelayMs, 120_000);
  assert.equal(agent.departureDelayMs, 0);
  assert.equal(agent.arrivalDelayMs, 0);
  assert.equal(agent.totalDelayMs, agent.arrivedAt - agent.expectedArrivalAt);
  assert.equal(state.stats.disruptedFlights, 1);
  assert.equal(state.stats.delayedArrivals, 1);
});

test('landing-approval delay is recorded separately from departure and travel', () => {
  const sim = new Simulation([flights[0]], { disruptions: [
    { factor: 'ATC_LINK_OUTAGE', startMs: 60_000, endMs: 300_000 },
  ] });
  const waiting = sim.advanceTo(240_000);
  assert.equal(waiting.stats.currentlyDelayed, 1);
  assert.ok(waiting.aircraft[0].arrivalDelayMs > 0);
  const agent = sim.advanceTo(400_000).aircraft[0];
  assert.equal(agent.departureDelayMs, 0);
  assert.equal(agent.travelDelayMs, 0);
  assert.equal(agent.arrivalDelayMs, agent.totalDelayMs);
  assert.equal(agent.totalDelayMs, agent.arrivedAt - agent.expectedArrivalAt);
});

test('delay labels retain seconds and distinguish absent timestamps', () => {
  assert.equal(timing.formatDelay(10_000), '0m 10s');
  assert.equal(timing.formatDelay(120_000), '2m 00s');
  assert.equal(timing.formatDelay(null), '—');
  assert.equal(timing.formatSimulationTime(190_000), '00:03:10');
  assert.equal(timing.formatSimulationTime(null), '—');
});

test('healthy references include ordinary latency and fractional-duration tick rounding', () => {
  for (const options of [
    { tickMs: 10_000, latencyMs: 0 },
    { tickMs: 10_000, latencyMs: 25_000 },
    { tickMs: 30_000, latencyMs: 40_000 },
  ]) {
    const state = new Simulation([{ ...flights[0], est_flight_dur: 2.05 }], options).advanceTo(3_600_000);
    assert.equal(state.aircraft[0].arrivedAt, state.aircraft[0].expectedArrivalAt);
    assert.equal(state.aircraft[0].totalDelayMs, 0);
    assert.equal(state.stats.disruptedFlights, 0);
  }
});

test('a scoped temporary slowdown preserves movement continuity and replays the same delay', () => {
  const options = { disruptions: [
    { factor: 'REDUCED_SPEED', agentId: 'aircraft:0', startMs: 60_000, endMs: 120_000, value: 0.5 },
  ] };
  const sim = new Simulation([flights[0], flights[0]], options);
  const start = sim.advanceTo(60_000);
  assert.equal(start.aircraft[0].progress, start.aircraft[1].progress);
  const beforeRecovery = sim.advanceTo(110_000).aircraft[0].progress;
  const atRecovery = sim.advanceTo(120_000).aircraft[0].progress;
  const recovered = sim.advanceTo(130_000).aircraft[0].progress;
  assert.ok(recovered - atRecovery > atRecovery - beforeRecovery);
  const final = sim.advanceTo(400_000);
  assert.equal(final.stats.disruptedFlights, 1);
  assert.equal(final.aircraft[1].totalDelayMs, 0);
  assert.ok(final.aircraft[0].totalDelayMs > 0);
  sim.advanceTo(0);
  assert.deepEqual(sim.advanceTo(400_000), final);
});

test('unfinished flights remain pending and accumulate delay without inventing arrivals', () => {
  const sim = new Simulation([flights[0]], { disruptions: [
    { factor: 'PACKET_LOSS', startMs: 0, endMs: 86_400_000, value: 1 },
  ] });
  const state = sim.advanceTo(86_399_999);
  assert.equal(state.stats.disruptedFlights, 1);
  assert.equal(state.stats.delayedArrivals, 0);
  assert.equal(state.aircraft[0].arrivedAt, null);
  assert.equal(state.aircraft[0].phase, 'REQUESTING_DEPARTURE');
  assert.ok(state.aircraft[0].totalDelayMs > 0);
  assert.equal(state.stats.meanArrivalDelayMs, null);
  assert.deepEqual(sim.advanceTo(86_399_999), state, 'no elapsed simulation time means no added delay');
});

test('zero speed and the old artificial stop mechanism are not valid failure models', () => {
  assert.throws(() => new Simulation(flights, { stops: [{ agentId: 'aircraft:0', timeMs: 80_000 }] }), /not supported/);
  assert.throws(() => new Simulation(flights, { disruptions: [
    { factor: 'REDUCED_SPEED', startMs: 0, endMs: 60_000, value: 0 },
  ] }), /Speed factor/);
});
