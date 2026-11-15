import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { FLIGHT_STATUS_BY_ID } from './flightStatus.js';
import {
  SUMMARY_STATUS_IDS, TRACKER_FILTERS, describeFlights, filterCounts, filterRows, sortRows, summariseStatuses,
} from './flightTracker.js';
import { formatSimulationTime } from '../simulation/timing.js';
import './flightTracker.css';

// Live list of flights and their disruptions (delays, detours, airport changes).
// Rendered as a flex child: the parent decides where it sits and how tall it may grow.
//   flights     map flight objects (agentId, flight_number, airport_dep, airport_dest, ...)
//   agentsById  snapshot.aircraft keyed by agent id
//   selectedId  agent id of the selected flight, or null
//   onSelect    called with the clicked flight object
//   time        completed simulation time (ms since day start, UTC)
//   closeCalls  current close calls from closeCalls.detectCloseCalls (optional)
export default function FlightTracker({ flights, agentsById, selectedId, onSelect, time, closeCalls }) {
  const [open, setOpen] = useState(true);
  const [filterId, setFilterId] = useState('disrupted');
  const bodyId = useId();
  const listRef = useRef(null);

  // Keep the row click handler stable so memoised rows do not re-render when the parent
  // passes a fresh onSelect function on every frame.
  const onSelectRef = useRef(onSelect);
  useEffect(() => { onSelectRef.current = onSelect; });
  const flightsById = useMemo(() => new Map(flights.map(flight => [flight.agentId, flight])), [flights]);
  const select = useCallback((id) => {
    const flight = flightsById.get(id);
    if (flight) onSelectRef.current?.(flight);
  }, [flightsById]);

  const rows = useMemo(() => describeFlights(flights, agentsById, { closeCalls: closeCalls ?? [] }),
    [flights, agentsById, closeCalls]);
  const statusCounts = useMemo(() => summariseStatuses(rows), [rows]);
  const tabCounts = useMemo(() => filterCounts(rows), [rows]);
  const visibleRows = useMemo(() => sortRows(filterRows(rows, filterId)), [rows, filterId]);
  const filter = TRACKER_FILTERS.find(item => item.id === filterId) ?? TRACKER_FILTERS[0];

  // Bring a flight picked on the map into view, scrolling only the list itself.
  useEffect(() => {
    const list = listRef.current;
    if (!open || !list || !selectedId) return;
    const item = [...list.children].find(child => child.dataset.agentId === selectedId);
    if (!item) return;
    if (item.offsetTop < list.scrollTop) list.scrollTop = item.offsetTop;
    else if (item.offsetTop + item.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = item.offsetTop + item.offsetHeight - list.clientHeight;
    }
  }, [selectedId, open, filterId]);

  return (
    <section className={open ? 'panel flight-tracker open' : 'panel flight-tracker'} aria-label="Flight tracker">
      <header className="flight-tracker-header">
        <div className="flight-tracker-title">
          <div>
            <h2>Flight tracker</h2>
            <p className="muted">
              {flights.length} flights{Number.isFinite(time) && <> · as of <span className="mono">{formatSimulationTime(time).slice(0, 5)}</span> UTC</>}
            </p>
          </div>
          <button
            type="button"
            className="flight-tracker-toggle"
            onClick={() => setOpen(value => !value)}
            aria-expanded={open}
            aria-controls={bodyId}
            aria-label={open ? 'Collapse flight tracker' : 'Expand flight tracker'}
          >
            ▾
          </button>
        </div>
        <ul className="flight-tracker-counts" aria-label="Flights by status">
          {SUMMARY_STATUS_IDS.map((id) => {
            const status = FLIGHT_STATUS_BY_ID[id];
            const count = statusCounts[id] ?? 0;
            return (
              <li key={id} className="flight-tracker-count" data-zero={String(count === 0)} title={status.label}
                style={{ '--dot': status.color }}>
                <i className="flight-tracker-dot" data-landed={String(status.landed)} aria-hidden="true" />
                <span className="mono">{count}</span> {status.short}
              </li>
            );
          })}
        </ul>
      </header>

      <div id={bodyId} className="flight-tracker-body" hidden={!open}>
        <div className="flight-tracker-filters" role="group" aria-label="Filter flights">
          {TRACKER_FILTERS.map(item => (
            <button key={item.id} type="button" aria-pressed={item.id === filterId} onClick={() => setFilterId(item.id)}>
              {item.label} <span className="mono">{tabCounts[item.id]}</span>
            </button>
          ))}
        </div>

        {visibleRows.length === 0
          ? <p className="flight-tracker-empty muted">{filter.empty}</p>
          : (
            <ul ref={listRef} className="flight-tracker-list" aria-label={`${filter.label} flights`}>
              {visibleRows.map(row => (
                <TrackerRow key={row.id} row={row} selected={row.id === selectedId} onSelect={select} />
              ))}
            </ul>
          )}
      </div>
    </section>
  );
}

const TrackerRow = memo(function TrackerRow({ row, selected, onSelect }) {
  return (
    <li data-agent-id={row.id}>
      <button
        type="button"
        className="flight-tracker-row"
        data-status={row.status}
        aria-current={selected ? 'true' : undefined}
        aria-label={row.ariaLabel}
        title={row.diversionTitle ?? row.statusLabel}
        onClick={() => onSelect(row.id)}
        style={{ '--dot': row.color }}
      >
        <i className="flight-tracker-dot" data-landed={String(row.landed)} aria-hidden="true" />
        <span className="flight-tracker-main">
          <span className="flight-tracker-flight mono">{row.flightNumber}</span>
          <span className="flight-tracker-route mono">
            {row.origin} →{' '}
            {row.previousDestination && <><s className="flight-tracker-old">{row.previousDestination}</s> → </>}
            <span className={row.previousDestination ? 'flight-tracker-new' : undefined}>{row.destination}</span>
          </span>
        </span>
        {row.delay && <span className="flight-tracker-delay mono" title={row.delayTitle}>{row.delay}</span>}
        <span className="flight-tracker-secondary">
          {row.lostContact && <span className="flight-tracker-nordo mono" title="Lost contact: squawking 7600, following its lost-comms procedure">7600</span>}
          {row.progress}{row.detail && <> · {row.detail}</>}
        </span>
        {row.closeCall && (
          <span className="flight-tracker-alert" data-kind={row.closeCall.kind} title={row.closeCall.text}>
            ⚠ {row.closeCall.text}
          </span>
        )}
      </button>
    </li>
  );
}, (previous, next) => previous.selected === next.selected && previous.onSelect === next.onSelect
  && previous.row.signature === next.row.signature && previous.row.id === next.row.id);
