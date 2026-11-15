import test from 'node:test';
import assert from 'node:assert/strict';
import { LINK_STATES, commsKind, linkState, messageLabel, summariseComms, trafficByAgent } from './commsLinks.js';

test('messages are classified by direction, peers and drops', () => {
  assert.equal(commsKind({ from: 'aircraft:0', to: 'atc:DEN', status: 'in-flight' }), 'uplink');
  assert.equal(commsKind({ from: 'atc:DEN', to: 'aircraft:0', status: 'delivered' }), 'downlink');
  assert.equal(commsKind({ from: 'aircraft:0', to: 'aircraft:1', status: 'in-flight' }), 'peer');
  assert.equal(commsKind({ from: 'aircraft:0', to: 'atc:DEN', status: 'dropped' }), 'dropped');
  assert.equal(messageLabel('DESTINATION_STATUS_REQUEST'), 'destination status request');
});

test('traffic per aircraft records exchanged and lost messages at both ends of a link', () => {
  const traffic = trafficByAgent([
    { from: 'aircraft:0', to: 'atc:DEN', type: 'ARRIVAL_REQUEST', status: 'in-flight' },
    { from: 'atc:DEN', to: 'aircraft:1', type: 'ARRIVAL_APPROVED', status: 'delivered' },
    { from: 'aircraft:2', to: 'atc:DEN', type: 'DESTINATION_STATUS_REQUEST', status: 'dropped' },
    { from: 'aircraft:0', to: 'aircraft:3', type: 'PEER_STATUS', status: 'dropped' },
  ]);
  assert.deepEqual(traffic.get('aircraft:0'), { active: true, dropped: true });
  assert.deepEqual(traffic.get('aircraft:1'), { active: true, dropped: false });
  assert.deepEqual(traffic.get('aircraft:2'), { active: false, dropped: true });
  assert.deepEqual(traffic.get('aircraft:3'), { active: false, dropped: true });
  assert.equal(traffic.has('atc:DEN'), false, 'only aircraft get a symbol');
  assert.equal(trafficByAgent(undefined).size, 0);
});

test('the symbol is green in contact, red when communication is lost, and absent after landing', () => {
  const airborne = { phase: 'EN_ROUTE', procedureState: null, squawk: null };
  assert.deepEqual(linkState(airborne, { active: true, dropped: false }), { state: 'live', transmitting: true });
  assert.deepEqual(linkState(airborne, undefined), { state: 'live', transmitting: false }, 'quiet but in contact');
  assert.equal(linkState(airborne, { active: false, dropped: true }).state, 'lost', 'everything it sent was lost');
  assert.equal(linkState(airborne, { active: true, dropped: true }).state, 'live', 'a single loss is not a lost link');
  assert.equal(linkState({ ...airborne, procedureState: { active: true } }).state, 'lost');
  assert.equal(linkState({ ...airborne, squawk: '7600' }).state, 'lost');
  assert.equal(linkState({ ...airborne, squawk: '7600' }, { active: true }).transmitting, false);
  assert.equal(linkState({ phase: 'ARRIVED', squawk: '7600' }).state, null);
  assert.equal(linkState(undefined).state, null);
  assert.deepEqual(LINK_STATES.map(state => state.id), ['live', 'lost']);
});

test('summaries count statuses and directions', () => {
  assert.deepEqual(summariseComms([
    { from: 'aircraft:0', to: 'atc:DEN', status: 'in-flight' },
    { from: 'atc:DEN', to: 'aircraft:0', status: 'delivered' },
    { from: 'aircraft:0', to: 'aircraft:1', status: 'dropped' },
  ]), { inFlight: 1, delivered: 1, dropped: 1, uplink: 1, downlink: 1, peer: 1 });
});
