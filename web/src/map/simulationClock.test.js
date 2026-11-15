import test from 'node:test';
import assert from 'node:assert/strict';
import * as simulation from './simulationClock.js';
import { SIMULATION_MS } from '../simulation/timing.js';
const { createClock, elapsedAt } = simulation;

const now = Date.parse('2026-11-14T15:30:00Z');
const SIX_HOURS = 6 * 60 * 60_000;

test('a simulation run starts at UTC midnight', () => {
  const clock = createClock(now);
  assert.equal(clock.startedAt, Date.parse('2026-11-14T00:00:00Z'));
  assert.equal(elapsedAt(clock, now, 60), 0);
});

test('seeking forwards and backwards pauses playback and clamps to the run', () => {
  const clock = createClock(now);
  const middle = simulation.seekClock(clock, now + 1000, SIX_HOURS);
  assert.equal(middle.paused, true);
  assert.equal(elapsedAt(middle, now + 5000, 60), SIX_HOURS);
  const start = simulation.seekClock(middle, now + 6000, -100);
  assert.equal(start.banked, 0);
  assert.equal(start.startedAt, clock.startedAt);
  const end = simulation.seekClock(start, now + 7000, 90_000_000);
  assert.equal(end.banked, SIMULATION_MS - 1);
});

test('playback respects speed, pause and stale ticks after seeking', () => {
  const clock = createClock(now);
  assert.equal(elapsedAt(clock, now + 1000, 60), 60_000);
  assert.equal(elapsedAt({ ...clock, multiplier: 4 }, now + 1000, 60), 240_000);
  const sought = simulation.seekClock(clock, now + 2000, SIX_HOURS);
  assert.equal(elapsedAt(sought, now + 100_000, 60), SIX_HOURS);
  const resumed = { ...sought, paused: false };
  assert.equal(elapsedAt(resumed, now + 1000, 60), SIX_HOURS);
  assert.equal(elapsedAt(resumed, now + 3000, 60), SIX_HOURS + 60_000);
});

test('playback stops at the end of the 8 h 30 min run', () => {
  const clock = createClock(now);
  const elapsed = elapsedAt(clock, now + 86_400_000, 60);
  assert.equal(elapsed, SIMULATION_MS - 1);
  assert.equal(new Date(clock.startedAt + elapsed).toISOString(), '2026-11-14T08:29:59.999Z');
});
