import { minutesRemaining } from './flights.js';

const STATUS_LABELS = {
  OK: 'OK',
  PANPAN: 'PAN-PAN',
  MAYDAY: 'MAYDAY',
};

// Details card for the selected aircraft.
export default function AircraftInfo({ flight, progress }) {
  const landed = progress >= 1;

  return (
    <div className="panel info">
      <div className="info-header">
        <div className="info-code">
          {flight.flight_number} <span>{flight.aircraft_reg} · {flight.type}</span>
        </div>
        <span className={`status-badge status-${flight.status.toLowerCase()}`}>
          {STATUS_LABELS[flight.status] ?? flight.status}
        </span>
      </div>

      <div>
        {flight.from.iata} → {flight.to.iata}
      </div>
      <div className="muted">
        {flight.from.city} → {flight.to.city}
      </div>

      <dl className="info-grid mono">
        <dt>Altitude</dt>
        <dd>FL{flight.altitude}</dd>

        <dt>Airspeed</dt>
        <dd>{flight.airspeed} kt</dd>

        <dt>Squawk</dt>
        <dd>{flight.squawk}</dd>

        <dt>Fuel</dt>
        <dd>{flight.fuel_remaining.toLocaleString('en-US')} kg</dd>

        <dt>Progress</dt>
        <dd>{landed ? 'Landed' : `${Math.round(progress * 100)}% · ${minutesRemaining(flight, progress)} min left`}</dd>
      </dl>
    </div>
  );
}
