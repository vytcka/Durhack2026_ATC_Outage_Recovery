import { useState } from 'react';
import { useNow } from './useNow.js';

// Simulated clock that runs `baseSpeed × multiplier` times faster than real time and can be
// paused, sped up and restarted.
//
// Because the speed can change mid-run, elapsed time can't just be (now - start) × speed.
// Instead the clock keeps:
//  - banked:       simulated ms accumulated before the current speed/pause setting
//  - segmentStart: real time when the current setting began
// Every change first "banks" the time run so far, then starts a new segment.
//
// Returns elapsed (simulated ms), simTime (Date), the current multiplier/paused state and controls.
export function useSimulationClock(baseSpeed, tickMs = 1) {
  const [clock, setClock] = useState(() => {
    const now = Date.now();
    return { startedAt: now, segmentStart: now, banked: 0, multiplier: 1, paused: false };
  });
  const now = useNow(tickMs);

  const elapsedAt = (state, time) => {
    if (state.paused) return state.banked;
    // Right after a change `now` can still be the previous tick (older than segmentStart),
    // so clamp instead of going backwards for one frame.
    return state.banked + Math.max(0, time - state.segmentStart) * baseSpeed * state.multiplier;
  };

  const update = (changes) =>
    setClock((state) => {
      const time = Date.now();
      return { ...state, banked: elapsedAt(state, time), segmentStart: time, ...changes };
    });

  const elapsed = elapsedAt(clock, now);

  return {
    elapsed,
    simTime: new Date(clock.startedAt + elapsed),
    multiplier: clock.multiplier,
    paused: clock.paused,
    setMultiplier: (multiplier) => update({ multiplier }),
    togglePause: () => update({ paused: !clock.paused }),
    reset: () => {
      const time = Date.now();
      setClock((state) => ({ ...state, startedAt: time, segmentStart: time, banked: 0 }));
    },
  };
}
