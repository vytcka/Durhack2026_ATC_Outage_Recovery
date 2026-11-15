import { formatDelay, formatSimulationTime } from '../simulation/timing.js';
import { AIRPORT_BY_IATA } from '../data/airports.js';
import { FLIGHT_STATUS_BY_ID, flightStatus, isAirborne } from './flightStatus.js';
import { diversionActionLabel, diversionReason, policyLabel } from './flightText.js';

const INPUT_STATUS_LABELS = { OK: 'OK', PANPAN: 'PAN-PAN', MAYDAY: 'MAYDAY' };

// "02:31" from simulation ms, or "—".
const clockTime = ms => (ms === null || ms === undefined ? '—' : formatSimulationTime(ms).slice(0, 5));

// Compact details card for the selected aircraft: key facts up front, the rest folded away.
export default function AircraftInfo({ flight, progress, agent, onDisrupt, canDisrupt, diversionPolicy, onClose }) {
  const status = flightStatus(agent);
  const statusInfo = FLIGHT_STATUS_BY_ID[status];
  const landed = agent?.phase === 'ARRIVED';
  const awaitingLanding = agent?.phase === 'AWAITING_ARRIVAL';
  const airborne = isAirborne(agent);
  const diverted = Boolean(agent?.diverted);
  const diversion = agent?.diversion;
  const newAirport = agent?.arrivalAirport ?? flight.to.iata;
  const previousAirport = diversion?.previousAirport ?? flight.to.iata;
  const reason = diverted ? diversionReason(diversion) : null;
  const action = diverted ? diversionActionLabel(diversion?.action) : null;
  const percent = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  const totalDelayMs = agent?.totalDelayMs ?? 0;

  const badge = awaitingLanding ? `${statusInfo.short} · landing` : statusInfo.short;

  let progressLabel = diverted ? `${percent}% to ${newAirport}` : `${percent}%`;
  if (!agent?.departedAt) progressLabel = 'Not departed';
  if (awaitingLanding) progressLabel = 'Awaiting landing';
  if (landed) progressLabel = diverted ? `Landed ${newAirport}` : 'Landed';

  const routeDecision = diverted
    ? `Diverted to ${newAirport} (${reason}${action ? `; ${action}` : ''})`
    : agent?.reroute ? 'ATC-approved corridor detour (longer route)' : 'Original route';
  const disruptHelp = 'Adds a 30-minute disruption on the next tick, then pauses. Airport closure affects every '
    + `flight using that airport; diverting aircraft follow the diversion policy (${policyLabel(diversionPolicy).toLowerCase()}).`;

  return (
    <section className="panel info aircraft-info" aria-label={`Flight ${flight.flight_number} details`}>
      <div className="info-header">
        <div className="info-code">
          {flight.flight_number} <span>{flight.aircraft_reg} · {flight.type}</span>
        </div>
        {onClose && (
          <button type="button" className="info-close" onClick={onClose} aria-label="Close flight details" title="Close">✕</button>
        )}
      </div>

      <div className="info-summary">
        <span className="status-badge" data-status={status} title={statusInfo.label}>{badge}</span>
        <span className="info-route mono" data-info="route"
          title={`${flight.from.city} → ${diverted ? (AIRPORT_BY_IATA[newAirport]?.city ?? newAirport) : flight.to.city}`}>
          {flight.from.iata} →{' '}
          {diverted ? <><s className="abandoned-airport">{previousAirport}</s> → <strong className="new-airport">{newAirport}</strong></> : flight.to.iata}
        </span>
      </div>

      {diverted && (
        <div className="diversion-note" data-info="diversion"
          title={`Original destination ${previousAirport} abandoned → now ${AIRPORT_BY_IATA[newAirport]?.name ?? newAirport}`}>
          {reason}{action ? ` · ${action}` : ''}
        </div>
      )}

      {agent?.departedAt != null && (
        <div className="info-progress" role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
          <span style={{ width: `${percent}%`, background: statusInfo.color }} />
        </div>
      )}

      <dl className="info-facts mono">
        <div><dt>Delay</dt><dd data-info="total-delay">{totalDelayMs > 0 ? `+${formatDelay(totalDelayMs)}` : 'None'}</dd></div>
        <div><dt>Progress</dt><dd>{progressLabel}</dd></div>
        <div><dt>Due</dt><dd data-info="expected-arrival">{clockTime(agent?.expectedArrivalAt)}</dd></div>
        <div><dt>Arrived</dt><dd data-info="actual-arrival">{agent?.arrivedAt == null ? 'Pending' : clockTime(agent.arrivedAt)}</dd></div>
      </dl>

      {onDisrupt && (
        <div className="info-actions" title={disruptHelp}>
          <button type="button" disabled={!canDisrupt || agent?.phase !== 'EN_ROUTE' || diverted || Boolean(agent?.reroute)}
            onClick={() => onDisrupt('NO_GO_REGION')}>Block route</button>
          <button type="button" disabled={!canDisrupt || !airborne || diverted}
            onClick={() => onDisrupt('AIRPORT_CLOSURE')}>Close destination</button>
        </div>
      )}

      <details className="info-details">
        <summary>More details</summary>
        <dl className="info-grid mono">
          <dt>Agent state</dt>
          <dd>{agent?.phase.toLowerCase().replaceAll('_', ' ') ?? 'initialising'}</dd>

          <dt>Original dest.</dt>
          <dd data-info="original-airport">{flight.to.iata}{diverted ? ' (abandoned)' : ''}</dd>

          <dt>Current dest.</dt>
          <dd data-info="current-airport">{newAirport}</dd>

          <dt>Route</dt>
          <dd data-info="route-decision">{routeDecision}</dd>

          {agent?.protocolDecision && <>
            <dt>Protocol rule</dt>
            <dd data-info="protocol-decision">{agent.protocolDecision.trigger} → {agent.protocolDecision.action}</dd>
          </>}

          <dt>Departure delay</dt>
          <dd>{formatDelay(agent?.departureDelayMs)}</dd>

          <dt>Travel delay</dt>
          <dd data-info="travel-delay">{formatDelay(agent?.travelDelayMs)}</dd>

          <dt>Arrival wait</dt>
          <dd>{formatDelay(agent?.arrivalDelayMs)}</dd>

          <dt>Known peers</dt>
          <dd>{agent?.knownPeers ?? 0}</dd>

          <dt>Priority</dt>
          <dd>{agent?.priority ? 'Yes' : 'No'}</dd>

          <dt>Climb / reserve</dt>
          <dd>{Math.round((agent?.climbProgress ?? 0) * 100)}% / {Math.round((agent?.reserve ?? 1) * 100)}%</dd>

          <dt>Timeouts</dt>
          <dd>{agent?.timeouts ?? 0}</dd>

          <dt>Altitude / speed</dt>
          <dd>FL{flight.altitude} · {flight.airspeed} kt</dd>

          <dt>Squawk</dt>
          <dd>{flight.squawk} · {INPUT_STATUS_LABELS[flight.status] ?? flight.status}</dd>

          <dt>Input fuel</dt>
          <dd>{flight.fuel_remaining.toLocaleString('en-US')} kg</dd>
        </dl>
      </details>
    </section>
  );
}
