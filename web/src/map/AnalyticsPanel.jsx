import { useMemo } from 'react';

// Collapsible stats panel shown under the title.
// The disruption index is still a placeholder passed in from the parent.
export default function AnalyticsPanel({ open, timeZone, simTime, elapsed, airborne, disruptionIndex, onReset }) {
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

  const clock = formatClock(clockFormat, simTime);

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

        <button className="reset-button" onClick={onReset}>
          Reset simulation
        </button>
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

// 3_725_000 ms -> "01h 02m"
function formatElapsed(ms) {
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const pad = (n) => String(n).padStart(2, '0');

  return `${pad(hours)}h ${pad(minutes)}m`;
}
