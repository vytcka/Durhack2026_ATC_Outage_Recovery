import { DISRUPTION_FACTORS } from './disruptions.js';
import { formatDelay } from './timing.js';
import DisruptionEditor from './DisruptionEditor.jsx';

export default function AgentNetworkPanel({ simulation, settings, onSettingsChange, scenarioEvents, onEventsChange, scenarioAircraft, scenarioAirports }) {
  const { snapshot, busy, error } = simulation;
  const stats = snapshot?.stats;
  const implemented = DISRUPTION_FACTORS.filter(factor => factor.implemented).length;
  const update = (key, value) => onSettingsChange({ ...settings, [key]: value });
  const names = Object.fromEntries((snapshot?.aircraft ?? []).map(agent => [agent.id, agent.flightNumber]));
  const name = id => names[id] ?? id;

  return (
    <section className="agent-network" aria-label="Agent network" data-busy={String(busy)}>
      <h2>Agent network <span className="muted">{busy ? 'Computing…' : 'Ready'}</span></h2>
      {error && <p role="alert" className="error">{error.message}</p>}
      <p className="muted">{snapshot?.aircraft.length ?? 0} aircraft · {stats?.atcAgents ?? 0} airport ATC agents</p>
      <dl className="network-stats">
        <div><dt>Awaiting departure</dt><dd data-stat="waiting">{stats?.waiting ?? 0}</dd></div>
        <div><dt>Arrived</dt><dd data-stat="arrived">{stats?.arrived ?? 0}</dd></div>
        <div><dt>Flights disrupted by delay</dt><dd data-stat="disrupted">{stats?.disruptedFlights ?? 0}</dd></div>
        <div><dt>Currently delayed</dt><dd>{stats?.currentlyDelayed ?? 0}</dd></div>
        <div><dt>Late arrivals</dt><dd data-stat="late-arrivals">{stats?.delayedArrivals ?? 0}</dd></div>
        <div><dt>Total accrued delay</dt><dd>{formatDelay(stats?.totalDelayMs ?? 0)}</dd></div>
        <div><dt>Mean arrival delay</dt><dd>{formatDelay(stats?.meanArrivalDelayMs)}</dd></div>
        <div><dt>Messages delivered</dt><dd data-stat="delivered">{stats?.delivered ?? 0}</dd></div>
        <div><dt>Messages dropped</dt><dd data-stat="dropped">{stats?.dropped ?? 0}</dd></div>
        <div><dt>Messages queued</dt><dd>{stats?.queued ?? 0}</dd></div>
        <div><dt>Request timeouts</dt><dd>{stats?.timeouts ?? 0}</dd></div>
        <div><dt>Reports rejected</dt><dd>{stats?.rejected ?? 0}</dd></div>
        <div><dt>Duplicate envelopes</dt><dd>{stats?.duplicates ?? 0}</dd></div>
        <div><dt>ATC restarts</dt><dd>{stats?.restarts ?? 0}</dd></div>
      </dl>
      <ul className="aircraft-legend" aria-label="Aircraft colours">
        <li><i className="key-en-route" />En route</li>
        <li><i className="key-landing" />Delayed / landing</li>
        <li><i className="key-landed" />Landed</li>
      </ul>
      <p className="muted">Delay is relative to the healthy-model baseline, not an airline schedule. Each affected flight counts once, including after landing.</p>
      <details>
        <summary>Scenario controls</summary>
        <p className="muted">Quick controls restart at midnight, paused. Changing aircraft count clears custom events.</p>
        <label htmlFor="agent-limit">Aircraft agents</label>
        <select id="agent-limit" value={settings.aircraftLimit} onChange={event => update('aircraftLimit', Number(event.target.value))}>
          {[25, 50, 100].map(limit => <option key={limit} value={limit}>{limit}</option>)}
        </select>
        <label className="outage-control">
          <input type="checkbox" checked={settings.outage} onChange={event => update('outage', event.target.checked)} />
          ATC outage, first 30 minutes
        </label>
        <label htmlFor="packet-loss">Packet loss (%)</label>
        <input id="packet-loss" type="range" min={0} max={100} step={10} value={settings.packetLoss}
          onChange={event => update('packetLoss', Number(event.target.value))} />
        <output htmlFor="packet-loss" className="mono">{settings.packetLoss}%</output>
        <label htmlFor="message-delay">Additional message delay (seconds)</label>
        <input id="message-delay" type="range" min={0} max={60} step={10} value={settings.delaySeconds}
          onChange={event => update('delaySeconds', Number(event.target.value))} />
        <output htmlFor="message-delay" className="mono">{settings.delaySeconds}s</output>
        <label htmlFor="travel-speed">Travel speed (%)</label>
        <input id="travel-speed" type="range" min={25} max={100} step={25} value={settings.travelSpeedPercent}
          onChange={event => update('travelSpeedPercent', Number(event.target.value))} />
        <output htmlFor="travel-speed" className="mono">{settings.travelSpeedPercent}% of nominal</output>
        <DisruptionEditor events={scenarioEvents} onChange={onEventsChange} aircraft={scenarioAircraft}
          airports={scenarioAirports} currentTime={snapshot?.time ?? 0} />
      </details>
      <details>
        <summary>Recent communication</summary>
        <ol className="message-log">
          {(snapshot?.events ?? []).slice(-10).reverse().map((event, index) => (
            <li key={`${event.time}:${index}`}>
              <span className="mono">{Math.floor(event.time / 60_000)}m</span>{' '}
              {event.type.replaceAll('_', ' ').toLowerCase()}
              {event.messageType && <> · {event.messageType.toLowerCase().replaceAll('_', ' ')}</>}
              <span className="muted"> {event.agentId ? name(event.agentId) : `${name(event.from)} → ${name(event.to)}`}</span>
            </li>
          ))}
        </ol>
      </details>
      <details>
        <summary>Disruption catalogue ({implemented}/{DISRUPTION_FACTORS.length} implemented)</summary>
        <ul className="factor-list">
          {DISRUPTION_FACTORS.map(factor => <li key={factor.id}>{factor.label} · {factor.implemented ? 'available' : 'planned'}</li>)}
        </ul>
      </details>
      <p className="muted model-note">Schematic coordination model, not aviation procedures. Airport slots, climb, reserve and alternate legs are simplified; separation and real departure schedules are not modelled.</p>
    </section>
  );
}
