import { useState } from 'react';
import { useNow } from './useNow.js';
import { createClock, elapsedAt, seekClock } from './simulationClock.js';

// Simulated clock that runs `baseSpeed × multiplier` times faster than real time and can be
// paused, sped up, scrubbed and restarted within a single UTC day.
//
// Because the speed can change mid-run, elapsed time can't just be (now - start) × speed.
// Instead the clock keeps:
//  - banked:       simulated ms accumulated before the current speed/pause setting
//  - segmentStart: real time when the current setting began
// Every change first "banks" the time run so far, then starts a new segment.
//
// Returns elapsed (simulated ms), simTime (Date), the current multiplier/paused state and controls.
export function useSimulationClock(baseSpeed, tickMs = 1) {
  const [clock, setClock] = useState(() => createClock(Date.now()));
  const now = useNow(tickMs);

  const update = (changes) =>
    setClock((state) => {
      const time = Date.now();
      return { ...state, banked: elapsedAt(state, time, baseSpeed), segmentStart: time, ...changes };
    });

  const elapsed = elapsedAt(clock, now, baseSpeed);

  return {
    elapsed,
    simTime: new Date(clock.startedAt + elapsed),
    multiplier: clock.multiplier,
    paused: clock.paused,
    setMultiplier: (multiplier) => update({ multiplier }),
    togglePause: () => update({ paused: !clock.paused }),
    seek: (elapsed) => setClock((state) => seekClock(state, Date.now(), elapsed)),
    reset: () => {
      const time = Date.now();
      setClock((state) => ({ ...state, segmentStart: time, banked: 0 }));
    },
  };
}
