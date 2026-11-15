import { DISRUPTION_FACTORS } from './disruptions.js';
import { formatDelay, formatSimulationTime } from './timing.js';
import DisruptionEditor from './DisruptionEditor.jsx';
import { AUTO_DISRUPTION_LEVELS } from './autoDisruptions.js';
import { delayCauseLabel } from './reasoning.js';
import { SUGGESTED_PROCEDURE_TEXT } from './procedures.js';
import { FLIGHT_STATUSES } from '../map/flightStatus.js';
import { DIVERSION_POLICIES } from '../map/flightText.js';
import { LINK_STATES } from '../map/commsLinks.js';
import ProcedureApply from '../map/ProcedureApply.jsx';

const clock = ms => formatSimulationTime(ms).slice(0, 5);

export default function AgentNetworkPanel({ simulation, settings, onSettingsChange, scenarioEvents, onEventsChange, scenarioAircraft, scenarioAirports,
  autoEvents = [], closeCallCount = 0, lossCount = 0, commsSummary, procedures, onProceduresChange }) {
  const { snapshot, busy, error } = simulation;
  const stats = snapshot?.stats;
  const implemented = DISRUPTION_FACTORS.filter(factor => factor.implemented).length;
  const update = (key, value) => onSettingsChange({ ...settings, [key]: value });
  const names = Object.fromEntries((snapshot?.aircraft ?? []).map(agent => [agent.id, agent.flightNumber]));
  const name = id => names[id] ?? id;
  // Measured delay attribution, largest first, as shares of the total.
  const causes = Object.entries(stats?.delayByCause ?? {}).filter(([, ms]) => ms > 0).sort((a, b) => b[1] - a[1]);
  const causeTotal = causes.reduce((sum, [, ms]) => sum + ms, 0);
  const overrides = Object.values(procedures?.byAgent ?? {}).filter(text => text?.trim()).length;
  const now = snapshot?.time ?? 0;

  return (
    <section className="agent-network" aria-label="Agent network" data-busy={String(busy)}>
      <h2>Agent network <span className="muted">{busy ? 'Computing…' : 'Ready'}</span></h2>
      {error && <p role="alert" className="error">{error.message}</p>}
      <p className="muted">{snapshot?.aircraft.length ?? 0} aircraft · {stats?.atcAgents ?? 0} airport ATC agents</p>

      {procedures && onProceduresChange && (
        <section className="procedure-settings" aria-labelledby="procedure-settings-heading">
          <h3 className="network-heading" id="procedure-settings-heading">
            Lost-comms protocol (all aircraft)
            <span className="muted"> · {stats?.lostContactFlights ?? 0} used</span>
          </h3>
          <p className="muted">Runs after 2 minutes without ATC. Stops when contact returns.</p>
          <ProcedureApply id="procedure-default" label="Blocks for every aircraft" applied={procedures.default}
            placeholder={SUGGESTED_PROCEDURE_TEXT}
            onApply={text => onProceduresChange({ ...procedures, default: text })} />
          <p className="muted">Apply replays to now. Landing needs ATC approval.</p>
          {overrides > 0 && <p className="muted">{overrides} aircraft use their own procedure (set on the plane card).</p>}
        </section>
      )}

      <h3 className="network-heading">Disruptions</h3>
      <dl className="network-stats">
        <div><dt>Flights affected (any)</dt><dd data-stat="affected">{stats?.affectedFlights ?? 0}</dd></div>
        <div><dt>Delayed flights</dt><dd data-stat="disrupted">{stats?.disruptedFlights ?? 0}</dd></div>
        <div><dt>Detoured flights</dt><dd data-stat="detoured">{stats?.detouredFlights ?? 0}</dd></div>
        <div><dt>Diverted flights</dt><dd data-stat="diverted">{stats?.divertedFlights ?? 0}</dd></div>
        <div><dt>Lost-contact flights</dt><dd data-stat="lost-contact">{stats?.lostContactFlights ?? 0}</dd></div>
        <div data-alert={String(closeCallCount > 0)}><dt>Close calls now</dt>
          <dd data-stat="close-calls">{closeCallCount}{lossCount > 0 && <span className="stat-alert"> · {lossCount} lost sep.</span>}</dd></div>
        <div><dt>Currently delayed</dt><dd>{stats?.currentlyDelayed ?? 0}</dd></div>
        <div><dt>Late arrivals</dt><dd data-stat="late-arrivals">{stats?.delayedArrivals ?? 0}</dd></div>
        <div><dt>Total accrued delay</dt><dd>{formatDelay(stats?.totalDelayMs ?? 0)}</dd></div>
        <div><dt>Mean arrival delay</dt><dd>{formatDelay(stats?.meanArrivalDelayMs)}</dd></div>
      </dl>

      {causes.length > 0 && (
        <details className="delay-causes" open>
          <summary>Delay by cause (measured)</summary>
          <ul>
            {causes.map(([cause, ms]) => (
              <li key={cause}>
                <span className="delay-cause-label">{delayCauseLabel(cause)}</span>
                <span className="mono">{formatDelay(ms)}</span>
                <i className="delay-cause-bar" style={{ width: `${Math.max(2, Math.round(ms / causeTotal * 100))}%` }} aria-hidden="true" />
              </li>
            ))}
          </ul>
          <p className="muted">Delay attributed to active causes.</p>
        </details>
      )}

      <h3 className="network-heading">Communication</h3>
      <dl className="network-stats">
        <div><dt>Messages in flight</dt><dd data-stat="in-flight">{commsSummary?.inFlight ?? stats?.queued ?? 0}</dd></div>
        <div><dt>Messages delivered</dt><dd data-stat="delivered">{stats?.delivered ?? 0}</dd></div>
        <div><dt>Messages dropped</dt><dd data-stat="dropped">{stats?.dropped ?? 0}</dd></div>
        <div><dt>Request timeouts</dt><dd>{stats?.timeouts ?? 0}</dd></div>
        <div><dt>Reports rejected</dt><dd>{stats?.rejected ?? 0}</dd></div>
        <div><dt>Duplicate envelopes</dt><dd>{stats?.duplicates ?? 0}</dd></div>
        <div><dt>ATC restarts</dt><dd>{stats?.restarts ?? 0}</dd></div>
      </dl>
      <ul className="comms-legend" aria-label="Radio-link symbol">
        {LINK_STATES.map(state => (
          <li key={state.id}><i className={`link-key link-key-${state.id}`} aria-hidden="true" />
            <span title={state.description}><strong>{state.label}</strong></span></li>
        ))}
      </ul>

      <ul className="aircraft-legend" aria-label="Aircraft colours">
        {FLIGHT_STATUSES.map(status => (
          <li key={status.id}><i className={`key-${status.id}`} />{status.label}</li>
        ))}
      </ul>
      <p className="muted">Dashed: old route · solid: new route · rings: close calls.</p>
      <p className="muted">Delay vs healthy model. Each flight counted once.</p>

      <details>
        <summary>Scenario controls</summary>
        <p className="muted">Quick controls restart at midnight, paused. Changing aircraft count clears custom events.</p>
        <label htmlFor="agent-limit">Aircraft agents</label>
        <select id="agent-limit" value={settings.aircraftLimit} onChange={event => update('aircraftLimit', Number(event.target.value))}>
          {[25, 50, 100].map(limit => <option key={limit} value={limit}>{limit}</option>)}
        </select>
        <label htmlFor="auto-disruptions">Automatic disruptions</label>
        <select id="auto-disruptions" value={settings.autoDisruptions} onChange={event => update('autoDisruptions', event.target.value)}>
          {AUTO_DISRUPTION_LEVELS.map(level => <option key={level.id} value={level.id}>{level.label}</option>)}
        </select>
        {autoEvents.length > 0 && (
          <details className="auto-events">
            <summary>{autoEvents.length} automatic events (seeded)</summary>
            <ol>
              {autoEvents.map(event => (
                <li key={event.id} data-state={now < event.startMs ? 'pending' : now >= event.endMs ? 'ended' : 'active'}>
                  <span className="mono">{clock(event.startMs)}–{clock(event.endMs)}</span> {event.label ?? event.factor}
                </li>
              ))}
            </ol>
          </details>
        )}
        <label className="outage-control">
          <input type="checkbox" checked={settings.outage} onChange={event => update('outage', event.target.checked)} />
          ATC outage, first 30 minutes
        </label>
        <label htmlFor="diversion-policy">Diversion policy (destination closed)</label>
        <select id="diversion-policy" value={settings.diversionPolicy} onChange={event => update('diversionPolicy', event.target.value)}>
          {DIVERSION_POLICIES.map(policy => <option key={policy.id} value={policy.id}>{policy.label}</option>)}
        </select>
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
        <label htmlFor="aircraft-range">Aircraft radio range (nm)</label>
        <input id="aircraft-range" type="range" min={10} max={100} step={10} value={settings.aircraftRangeNm}
          onChange={event => update('aircraftRangeNm', Number(event.target.value))} />
        <output htmlFor="aircraft-range" className="mono">{settings.aircraftRangeNm} nm · plane to plane</output>
        <label htmlFor="tower-range">Tower radio range (nm)</label>
        <input id="tower-range" type="range" min={10} max={100} step={10} value={settings.towerRangeNm}
          onChange={event => update('towerRangeNm', Number(event.target.value))} />
        <output htmlFor="tower-range" className="mono">{settings.towerRangeNm} nm · tower to plane</output>
        <DisruptionEditor events={scenarioEvents} onChange={onEventsChange} aircraft={scenarioAircraft}
          airports={scenarioAirports} currentTime={now} />
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
      <p className="muted model-note">Schematic coordination model, not aviation procedures. Airport slots, climb, reserve and alternate legs are simplified; separation monitoring is a straight-line look-ahead on the drawn positions.</p>
    </section>
  );
}
