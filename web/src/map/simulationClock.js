import { SIMULATION_MS } from '../simulation/timing.js';

export const DAY_MS = 86_400_000;

// Use a fixed UTC day so panning the map cannot change the timeline's meaning.
export function createClock(time) {
  return {
    startedAt: Math.floor(time / DAY_MS) * DAY_MS,
    segmentStart: time,
    banked: 0,
    multiplier: 1,
    paused: false,
  };
}

export function elapsedAt(state, time, baseSpeed) {
  const running = state.paused ? 0 : Math.max(0, time - state.segmentStart) * baseSpeed * state.multiplier;
  return Math.min(SIMULATION_MS - 1, Math.max(0, state.banked + running));
}

export function seekClock(state, time, elapsed) {
  return { ...state, segmentStart: time, banked: Math.min(SIMULATION_MS - 1, Math.max(0, elapsed)), paused: true };
}
