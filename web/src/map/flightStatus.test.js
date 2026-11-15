import test from 'node:test';
import assert from 'node:assert/strict';
import { FLIGHT_STATUSES, flightStatus, isAirborne, isDisrupted } from './flightStatus.js';

const agent = overrides => ({ phase: 'EN_ROUTE', delayed: false, diverted: false, reroute: null, ...overrides });

test('late and diverted landings never share the on-time landed status', () => {
  assert.equal(flightStatus(agent({ phase: 'ARRIVED' })), 'landed');
  assert.equal(flightStatus(agent({ phase: 'ARRIVED', delayed: true })), 'landed-late');
  assert.equal(flightStatus(agent({ phase: 'ARRIVED', diverted: true })), 'diverted-landed');
  assert.equal(flightStatus(agent({ phase: 'ARRIVED', diverted: true, delayed: true })), 'diverted-landed');
});

test('a detour is still counted after landing, ahead of lateness but behind a diversion', () => {
  const reroute = { startProgress: 0.2, reason: 'NO_GO_REGION' };
  assert.equal(flightStatus(agent({ phase: 'ARRIVED', reroute })), 'detoured-landed');
  assert.equal(flightStatus(agent({ phase: 'ARRIVED', reroute, delayed: true })), 'detoured-landed');
  assert.equal(flightStatus(agent({ phase: 'ARRIVED', reroute, diverted: true })), 'diverted-landed');
  assert.equal(isDisrupted(agent({ phase: 'ARRIVED', reroute })), true);
});

test('airborne delayed flights are distinct from on-time flights; route changes take precedence', () => {
  assert.equal(flightStatus(agent()), 'on-time');
  assert.equal(flightStatus(agent({ phase: 'AWAITING_ARRIVAL' })), 'on-time');
  assert.equal(flightStatus(agent({ delayed: true })), 'delayed');
  assert.equal(flightStatus(agent({ phase: 'AWAITING_ARRIVAL', delayed: true })), 'delayed');
  assert.equal(flightStatus(agent({ delayed: true, reroute: { startProgress: 0.2 } })), 'detouring');
  assert.equal(flightStatus(agent({ reroute: { startProgress: 0.2 }, diverted: true })), 'diverting');
});

test('grounded flights are scheduled unless their departure is already late', () => {
  assert.equal(flightStatus(undefined), 'scheduled');
  assert.equal(flightStatus(agent({ phase: 'REQUESTING_DEPARTURE' })), 'scheduled');
  assert.equal(flightStatus(agent({ phase: 'WAITING', delayed: true })), 'delayed');
});

test('helpers agree with the status table', () => {
  assert.equal(new Set(FLIGHT_STATUSES.map(status => status.id)).size, FLIGHT_STATUSES.length);
  assert.equal(isAirborne(agent()), true);
  assert.equal(isAirborne(agent({ phase: 'ARRIVED' })), false);
  assert.equal(isDisrupted(agent()), false);
  assert.equal(isDisrupted(agent({ delayed: true })), true);
  assert.equal(isDisrupted(agent({ phase: 'ARRIVED', diverted: true })), true);
});
