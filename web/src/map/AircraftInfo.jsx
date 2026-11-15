import { formatDelay, formatSimulationTime } from '../simulation/timing.js';
import { AIRPORT_BY_IATA } from '../data/airports.js';
import { formatAltitude } from './physics.js';

const STATUS_LABELS = {
  OK: 'OK',
  PANPAN: 'PAN-PAN',
  MAYDAY: 'MAYDAY',
};

// Details card for the selected aircraft.
export default function AircraftInfo({ flight, progress, agent, physics }) {
  const landed = agent?.phase === 'ARRIVED';
  const awaitingLanding = agent?.phase === 'AWAITING_ARRIVAL';
  const outcome = landed ? (agent.delayed ? 'Landed · delayed' : 'Landed successfully')
    : agent?.delayed ? 'Delayed' : awaitingLanding ? 'Awaiting landing approval' : null;
  let progressLabel = `${Math.round(progress * 100)}% of route`;
  if (!agent?.departedAt) progressLabel = 'Awaiting departure';
  if (awaitingLanding) progressLabel = 'Awaiting landing approval';
  if (landed) progressLabel = 'Landed successfully';


  return (
    <div className="panel info">
      <div className="info-header">
        <div className="info-code">
          {flight.flight_number} <span>{flight.aircraft_reg} · {flight.type}</span>
        </div>
        <span className={`status-badge status-${flight.status.toLowerCase()} phase-${agent?.phase.toLowerCase()}${agent?.delayed ? ' is-delayed' : ''}`}>
          {outcome ?? STATUS_LABELS[flight.status] ?? flight.status}
        </span>
      </div>

      <div>
        {flight.from.iata} → {flight.to.iata}
      </div>
      <div className="muted">
        {flight.from.city} → {flight.to.city}
      </div>
      {agent?.diverted && <div>Alternate: {AIRPORT_BY_IATA[agent.arrivalAirport]?.name ?? agent.arrivalAirport} (schematic return leg)</div>}

      <dl className="info-grid mono">
        <dt>Agent state</dt>
        <dd>{agent?.phase.toLowerCase().replaceAll('_', ' ') ?? 'initialising'}</dd>

        <dt>Current destination</dt>
        <dd data-info="current-airport">{agent?.arrivalAirport ?? flight.to.iata}</dd>

        <dt>Known peers</dt>
        <dd>{agent?.knownPeers ?? 0}</dd>

        <dt>Priority request</dt>
        <dd>{agent?.priority ? 'Yes' : 'No'}</dd>

        <dt>Virtual climb</dt>
        <dd>{Math.round((agent?.climbProgress ?? 0) * 100)}%</dd>

        <dt>Virtual reserve</dt>
        <dd>{Math.round((agent?.reserve ?? 1) * 100)}%</dd>

        <dt>Request timeouts</dt>
        <dd>{agent?.timeouts ?? 0}</dd>

        <dt>Scheduled departure</dt>
        <dd>{flight.departure_time ?? '00:00'} UTC</dd>

        <dt>Healthy-model arrival</dt>
        <dd data-info="expected-arrival">{formatSimulationTime(agent?.expectedArrivalAt)} UTC</dd>

        <dt>Actual arrival</dt>
        <dd data-info="actual-arrival">{agent?.arrivedAt == null ? 'Pending' : `${formatSimulationTime(agent.arrivedAt)} UTC`}</dd>

        <dt>Departure delay</dt>
        <dd>{formatDelay(agent?.departureDelayMs)}</dd>

        <dt>Travel delay</dt>
        <dd data-info="travel-delay">{formatDelay(agent?.travelDelayMs)}</dd>

        <dt>Arrival wait delay</dt>
        <dd>{formatDelay(agent?.arrivalDelayMs)}</dd>

        <dt>Total accrued delay</dt>
        <dd data-info="total-delay">{formatDelay(agent?.totalDelayMs)}</dd>

        <dt>Flight phase</dt>
        <dd>{physics ? physics.phase.toLowerCase() : 'ground'}</dd>

        <dt>Altitude</dt>
        <dd>{formatAltitude(physics?.altitudeFt ?? 0)}</dd>

        <dt>Vertical rate</dt>
        <dd>{formatVerticalRate(physics?.verticalRate ?? 0)}</dd>

        <dt>Ground speed</dt>
        <dd>{physics?.groundSpeedKt ?? 0} kt</dd>

        <dt>Squawk</dt>
        <dd>{flight.squawk}</dd>

        <dt>Fuel</dt>
        <dd>{(physics?.fuelKg ?? flight.fuel_remaining).toLocaleString('en-US')} kg</dd>

        <dt>Progress</dt>
        <dd>{progressLabel}</dd>
      </dl>

    </div>
  );
}

// 1834 -> "↑ 1,800 ft/min", 0 -> "level"
function formatVerticalRate(feetPerMinute) {
  const rounded = Math.round(feetPerMinute / 100) * 100;
  if (rounded === 0) return 'level';
  const arrow = rounded > 0 ? '↑' : '↓';
  return `${arrow} ${Math.abs(rounded).toLocaleString('en-US')} ft/min`;
}
