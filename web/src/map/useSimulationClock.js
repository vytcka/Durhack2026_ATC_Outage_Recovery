import { useState } from 'react';
import { useNow } from './useNow.js';

// Simulated clock that runs `speed` times faster than real time and can be restarted.
//
// Returns:
//  - elapsed: simulated milliseconds since the (last) start
//  - simTime: the simulated current time as a Date
//  - reset:   restarts the simulation from "now"
export function useSimulationClock(speed, tickMs = 1) {
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const now = useNow(tickMs);

  // Right after a reset `now` can still hold the previous tick (older than startedAt),
  // so clamp to 0 instead of showing a negative time for one frame.
  const elapsed = Math.max(0, (now - startedAt) * speed);

  return {
    elapsed,
    simTime: new Date(startedAt + elapsed),
    reset: () => setStartedAt(Date.now()),
  };
}
