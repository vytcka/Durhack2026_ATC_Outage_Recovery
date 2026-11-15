import test from 'node:test';
import assert from 'node:assert/strict';
import * as simulation from './simulationClock.js';
const { createClock, elapsedAt } = simulation;

const now = Date.parse('2026-11-14T15:30:00Z');

test('a simulation day starts at UTC midnight', () => {
  const clock = createClock(now);
  assert.equal(clock.startedAt, Date.parse('2026-11-14T00:00:00Z'));
  assert.equal(elapsedAt(clock, now, 60), 0);
});

test('seeking forwards and backwards pauses playback and clamps to the day', () => {
  const clock = createClock(now);
  const noon = simulation.seekClock(clock, now + 1000, 12 * 60 * 60_000);
  assert.equal(noon.paused, true);
  assert.equal(elapsedAt(noon, now + 5000, 60), 43_200_000);
  const start = simulation.seekClock(noon, now + 6000, -100);
  assert.equal(start.banked, 0);
  assert.equal(start.startedAt, clock.startedAt);
  const end = simulation.seekClock(start, now + 7000, 90_000_000);
  assert.equal(end.banked, 86_399_999);
});

test('playback respects speed, pause and stale ticks after seeking', () => {
  const clock = createClock(now);
  assert.equal(elapsedAt(clock, now + 1000, 60), 60_000);
  assert.equal(elapsedAt({ ...clock, multiplier: 4 }, now + 1000, 60), 240_000);
  const sought = simulation.seekClock(clock, now + 2000, 43_200_000);
  assert.equal(elapsedAt(sought, now + 100_000, 60), 43_200_000);
  const resumed = { ...sought, paused: false };
  assert.equal(elapsedAt(resumed, now + 1000, 60), 43_200_000);
  assert.equal(elapsedAt(resumed, now + 3000, 60), 43_260_000);
});

test('playback stops at the end of its original day', () => {
  const clock = createClock(now);
  const elapsed = elapsedAt(clock, now + 86_400_000, 60);
  assert.equal(elapsed, 86_399_999);
  assert.equal(new Date(clock.startedAt + elapsed).toISOString(), '2026-11-14T23:59:59.999Z');
});
