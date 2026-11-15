import { useEffect, useRef, useState } from 'react';

const FADE_MS = 800;      // keep in sync with the `signal-fade` animation in styles.css
const MAX_BATCHES = 40;   // upper bound on DOM nodes, whatever the playback speed

// Live communication overlay: every message the engine sends is drawn as a thin line between
// the two nodes, which fades out in under a second.
//
// To stay cheap with hundreds of messages a second, lines are not individual elements. All
// messages from one snapshot become a single <path> ("M a L b M c L d ..."), and the whole
// path fades with one CSS animation. So the DOM holds a handful of paths at any moment, and
// no direction vectors are needed: each segment just joins the two current positions.
//
// `signals` come from the engine snapshot ({ id, time, from, to, dropped }); `positionOf`
// turns a node id ("aircraft:3", "atc:ATL") into map coordinates, or null if it isn't drawn.
export default function SignalLayer({ signals, time, positionOf }) {
  const [batches, setBatches] = useState([]);
  const lastTime = useRef(null);
  const batchCounter = useRef(0);

  // Read through a ref so a new positionOf on every render doesn't re-run the effect.
  const positionRef = useRef(positionOf);
  positionRef.current = positionOf;

  useEffect(() => {
    if (!signals) return;

    // After a backward seek, start fresh rather than replaying old messages.
    if (lastTime.current !== null && time < lastTime.current) lastTime.current = null;
    // When first switched on, show only the latest step, not the whole retained window.
    const since = lastTime.current ?? time - 1;
    lastTime.current = time;

    let delivered = '';
    let dropped = '';
    for (const signal of signals) {
      if (signal.time <= since) continue;
      const from = positionRef.current(signal.from);
      const to = positionRef.current(signal.to);
      if (!from || !to) continue;

      const segment = `M${from[0]},${from[1]}L${to[0]},${to[1]}`;
      if (signal.dropped) dropped += segment;
      else delivered += segment;
    }
    if (!delivered && !dropped) return;

    const now = performance.now();
    const batch = { key: ++batchCounter.current, delivered, dropped, bornAt: now };
    // Drop batches that have already faded out, then add the new one.
    setBatches(previous => [...previous.filter(item => now - item.bornAt < FADE_MS), batch].slice(-MAX_BATCHES));
  }, [signals, time]);

  return (
    <g className="signals" aria-hidden="true">
      {batches.map(batch => (
        <g key={batch.key} className="signal-batch">
          {batch.delivered && <path className="signal" d={batch.delivered} />}
          {batch.dropped && <path className="signal dropped" d={batch.dropped} />}
        </g>
      ))}
    </g>
  );
}
