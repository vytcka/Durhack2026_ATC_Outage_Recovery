import test from 'node:test';
import assert from 'node:assert/strict';
import {
  closeCallLabel, closeCallsByFlight, describeCloseCall, detectCloseCalls, formatCpaTime, SEPARATION,
} from './closeCalls.js';

// 1 map unit = 1 NM keeps the arithmetic readable.
const track = overrides => ({ id: 'a', position: [0, 0], heading: 90, speedKt: 480, altitudeFt: 35_000,
  verticalRate: 0, nmPerUnit: 1, ...overrides });

test('two planes at the same point and level are a loss of separation', () => {
  const [call] = detectCloseCalls([track({ id: 'a' }), track({ id: 'b', position: [2, 0], altitudeFt: 35_400 })]);
  assert.equal(call.kind, 'loss');
  assert.equal(call.a, 'a');
  assert.equal(call.b, 'b');
  assert.equal(call.distanceNm, 2);
  assert.equal(call.verticalFt, 400);
  assert.deepEqual(call.from, [0, 0]);
  assert.deepEqual(call.to, [2, 0]);
  assert.equal(closeCallLabel(call), '2.0 NM · 400 ft');
});

test('head-on traffic is flagged before separation is lost, with the time to closest approach', () => {
  // 30 NM apart, closing at 16 NM/min: CPA (0 NM) in 1.875 min, inside the 3-minute look-ahead.
  const calls = detectCloseCalls([
    track({ id: 'east', position: [0, 0], heading: 90 }),
    track({ id: 'west', position: [30, 0], heading: 270 }),
  ]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].kind, 'predicted');
  assert.ok(Math.abs(calls[0].cpaMinutes - 1.875) < 1e-9);
  assert.ok(calls[0].cpaNm < 1e-9);
  assert.equal(formatCpaTime(calls[0].cpaMinutes), '1m 53s');
});

test('vertical separation, diverging tracks and distant traffic are not close calls', () => {
  assert.deepEqual(detectCloseCalls([track({ id: 'a' }), track({ id: 'b', position: [1, 0], altitudeFt: 37_000 })]), []);
  assert.deepEqual(detectCloseCalls([
    track({ id: 'a', position: [0, 0], heading: 270 }), track({ id: 'b', position: [8, 0], heading: 90 }),
  ]), []);
  assert.deepEqual(detectCloseCalls([track({ id: 'a' }), track({ id: 'b', position: [500, 0], heading: 270 })]), []);
});

test('a climb into another plane\'s level is predicted from the vertical rate', () => {
  // Same course and speed 3 NM apart laterally, 1 500 ft below and climbing 1 000 ft/min.
  const calls = detectCloseCalls([
    track({ id: 'level', position: [0, 0], heading: 0 }),
    track({ id: 'climber', position: [3, 0], heading: 0, altitudeFt: 33_500, verticalRate: 1000 }),
  ]);
  // Parallel tracks never get closer laterally, so there is no CPA in the future: no predicted call.
  assert.deepEqual(calls, []);
  const crossing = detectCloseCalls([
    track({ id: 'level', position: [0, 0], heading: 90, speedKt: 300 }),
    track({ id: 'climber', position: [12, -12], heading: 180, speedKt: 300, altitudeFt: 33_500, verticalRate: 1000 }),
  ]);
  assert.equal(crossing.length, 1);
  assert.equal(crossing[0].kind, 'predicted');
});

test('invalid tracks are ignored and the worst call wins per flight', () => {
  assert.deepEqual(detectCloseCalls([track({ id: 'a', nmPerUnit: NaN }), track({ id: 'b' })]), []);
  const calls = detectCloseCalls([
    track({ id: 'a' }),
    track({ id: 'b', position: [1, 0] }),
    track({ id: 'c', position: [30, 0], heading: 270 }),
  ]);
  const byFlight = closeCallsByFlight(calls);
  assert.equal(byFlight.get('a').kind, 'loss');
  assert.equal(byFlight.get('b').kind, 'loss');
  assert.equal(calls[0].kind, 'loss', 'losses sort before predictions');
  assert.match(describeCloseCall(byFlight.get('a'), 'a', id => id.toUpperCase()), /^Loss of separation with B · /);
  assert.equal(describeCloseCall(null, 'a'), null);
  assert.equal(SEPARATION.lateralNm, 5);
});
