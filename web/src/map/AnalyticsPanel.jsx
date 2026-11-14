import { useMemo } from 'react';
import { useNow } from './useNow.js';

// Collapsible stats panel shown under the title.
//
// Everything here is placeholder data until the simulation is wired in:
//  - simulated time starts at `startedAt` and runs `speed` times faster than real time,
//  - airborne / disruption values come straight from props.
export default function AnalyticsPanel({ open, timeZone, startedAt, speed, airborne, disruptionIndex }) {
  const realNow = useNow();

  // Scale the real time passed since start, then add it back onto the start time.
  // With speed = 60, every real second moves the simulated clock forward one minute.
  const elapsed = (realNow - startedAt) * speed;
  const simNow = new Date(startedAt + elapsed);

  const clockFormat = useMemo(
    () =>
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
        timeZoneName: 'short',
      }),
    [timeZone]
  );

  const clock = formatClock(clockFormat, simNow);

  return (
    <div className={open ? 'analytics-drawer open' : 'analytics-drawer'} aria-hidden={!open}>
      <section id="analytics" className="panel analytics">
        <dl className="stats">
          <div className="stat">
            <dt>Local time</dt>
            <dd className="mono">
              {clock.time} <span className="muted">{clock.zone}</span>
            </dd>
          </div>

          <div className="stat">
            <dt>Simulation running</dt>
            <dd className="mono">{formatElapsed(elapsed)}</dd>
          </div>

          <div className="stat">
            <dt>Planes airborne</dt>
            <dd className="mono">{airborne.toLocaleString('en-US')}</dd>
          </div>

          <div className="stat">
            <dt>Disruption index</dt>
            <dd className="mono">{disruptionIndex.toFixed(2)}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}

// Splits "14:05 PST" into the time and the zone abbreviation so they can be styled separately.
function formatClock(format, date) {
  const parts = format.formatToParts(date);
  const part = (type) => parts.find((p) => p.type === type)?.value ?? '';

  return {
    time: `${part('hour')}:${part('minute')}`,
    zone: part('timeZoneName'),
  };
}

// 3_725_000 ms -> "01h 02m 05s"
function formatElapsed(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n) => String(n).padStart(2, '0');

  return `${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`;
}
