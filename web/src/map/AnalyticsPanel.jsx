import { useMemo } from 'react';
import AgentNetworkPanel from '../simulation/AgentNetworkPanel.jsx';
import { SIMULATION_MINUTES } from '../simulation/timing.js';

// Collapsible stats panel shown under the title.
export default function AnalyticsPanel({ open, timeZone, simTime, elapsed, airborne, disruptionIndex, onReset, onSeek, simulation, settings, onSettingsChange, scenarioEvents, onEventsChange, scenarioAircraft, scenarioAirports,
  autoEvents, closeCallCount, lossCount, commsSummary, procedures, onProceduresChange, showSignals, onShowSignalsChange }) {
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
  const minuteOfDay = Math.floor(elapsed / 60_000);
  const timelineTime = `${String(Math.floor(minuteOfDay / 60)).padStart(2, '0')}:${String(minuteOfDay % 60).padStart(2, '0')}`;

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
            <dt>Time since day start</dt>
            <dd className="mono">{formatElapsed(elapsed)}</dd>
          </div>

          <div className="stat">
            <dt>Planes airborne</dt>
            <dd className="mono">{airborne.toLocaleString('en-US')}</dd>
          </div>

          <div className="stat">
            <dt>Message loss</dt>
            <dd className="mono">{(disruptionIndex * 100).toFixed(1)}%</dd>
          </div>
        </dl>

        <div className="day-timeline">
          <div className="timeline-heading">
            <label htmlFor="simulation-time">Simulation time (UTC)</label>
            <output htmlFor="simulation-time" className="mono">{timelineTime}</output>
          </div>
          <input
            id="simulation-time"
            type="range"
            min={0}
            max={SIMULATION_MINUTES - 1}
            step={1}
            value={minuteOfDay}
            onChange={(event) => onSeek(Number(event.target.value) * 60_000)}
            aria-valuetext={`${timelineTime} UTC`}
          />
          <div className="timeline-labels mono">
            <span>00:00</span><span>{minuteLabel(SIMULATION_MINUTES / 2)}</span><span>{minuteLabel(SIMULATION_MINUTES - 1)}</span>
          </div>
          <p className="muted">Drag to seek · pauses playback</p>
        </div>

        <label className="signals-toggle">
          <input
            type="checkbox"
            role="switch"
            checked={showSignals}
            onChange={(event) => onShowSignalsChange(event.target.checked)}
          />
          <span>
            Live communications
            <small className="muted">Each line is one message · red dashed = lost</small>
          </span>
        </label>

        <AgentNetworkPanel simulation={simulation} settings={settings} onSettingsChange={onSettingsChange}
          scenarioEvents={scenarioEvents} onEventsChange={onEventsChange} scenarioAircraft={scenarioAircraft} scenarioAirports={scenarioAirports}
          autoEvents={autoEvents} closeCallCount={closeCallCount} lossCount={lossCount} commsSummary={commsSummary}
          procedures={procedures} onProceduresChange={onProceduresChange} />

        <button className="reset-button" onClick={onReset}>
          Reset simulation
        </button>
      </section>
    </div>
  );
}

// 255 -> "04:15": timeline labels follow the run length instead of being hard-coded.
function minuteLabel(totalMinutes) {
  const minutes = Math.floor(totalMinutes);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
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
