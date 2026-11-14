import { useMemo, useRef, useState } from 'react';
import { pointer } from 'd3-selection';
import { AIRPORTS } from '../data/airports.js';
import { timeZoneAt } from '../data/timeZones.js';
import { WIDTH, HEIGHT, projection, paths } from './geography.js';
import { useZoom } from './useZoom.js';
import { useSimulationClock } from './useSimulationClock.js';
import { useAircraft } from './useAircraft.js';
import { flightProgress } from './flights.js';
import AirportMarker from './AirportMarker.jsx';
import Aircraft from './Aircraft.jsx';
import AircraftInfo from './AircraftInfo.jsx';
import AnalyticsPanel from './AnalyticsPanel.jsx';

const MAX_ZOOM = 60;
const SHOW_NAMES_AT_ZOOM = 6;
const SHOW_AIRCRAFT_LABELS_AT_ZOOM = 3;
const FOCUS_ZOOM = 14;
const SIM_SPEED = 60; // simulated seconds per real second (1 real second = 1 simulated minute)

export default function AirspaceMap() {
  const svgRef = useRef(null);
  const { transform, zoomIn, zoomOut, reset, focus } = useZoom(svgRef, MAX_ZOOM);
  const clock = useSimulationClock(SIM_SPEED);
  const { flights, error: aircraftError } = useAircraft();

  const [selectedAirport, setSelectedAirport] = useState(null);
  const [selectedReg, setSelectedReg] = useState(null); // aircraft_reg of the selected aircraft
  const [cursor, setCursor] = useState(null); // [lon, lat] under the mouse
  const [analyticsOpen, setAnalyticsOpen] = useState(true);

  const progressByReg = Object.fromEntries(
    flights.map((flight) => [flight.aircraft_reg, flightProgress(flight, clock.elapsed)])
  );
  const airborneFlights = flights.filter((flight) => progressByReg[flight.aircraft_reg] < 1);
  const selectedFlight = flights.find((flight) => flight.aircraft_reg === selectedReg);

  // TODO: replace with the real value once the simulation is connected.
  const disruptionIndex = 0;

  // The clock follows whatever is in the middle of the screen. The viewBox centre is also the
  // screen centre (the SVG scales uniformly), so undo the zoom transform, then the projection,
  // to get the [lon, lat] being looked at.
  const timeZone = useMemo(() => {
    const viewCenter = projection.invert(transform.invert([WIDTH / 2, HEIGHT / 2]));
    return timeZoneAt(viewCenter);
  }, [transform]);

  const selectAirport = (airport) => {
    setSelectedReg(null);
    setSelectedAirport(airport);
    focus(projection([airport.lon, airport.lat]), FOCUS_ZOOM);
  };

  const selectAircraft = (flight) => {
    setSelectedAirport(null);
    setSelectedReg(flight.aircraft_reg);
  };

  const resetView = () => {
    setSelectedAirport(null);
    setSelectedReg(null);
    reset();
  };

  const trackCursor = (event) => {
    const screenPoint = pointer(event, svgRef.current);
    setCursor(projection.invert(transform.invert(screenPoint)));
  };

  return (
    <div className="map">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        onMouseMove={trackCursor}
        onMouseLeave={() => setCursor(null)}
      >
        <g transform={transform.toString()}>
          <path className="graticule" d={paths.graticule} />
          <path className="land" d={paths.land} />
          <path className="state-borders" d={paths.stateBorders} />
          <path className="coastline" d={paths.coastline} />
          <path className="ring-outer" d={paths.outerRings} />
          <path className="ring-inner" d={paths.innerRings} />

          {selectedFlight && <path className="route-selected" d={selectedFlight.routePath} />}

          {AIRPORTS.map((airport) => (
            <AirportMarker
              key={airport.iata}
              airport={airport}
              position={projection([airport.lon, airport.lat])}
              scale={1 / transform.k}
              showName={transform.k >= SHOW_NAMES_AT_ZOOM}
              selected={airport === selectedAirport}
              onClick={() => selectAirport(airport)}
            />
          ))}

          {/* Aircraft are drawn last so they sit on top of airports and routes. */}
          {airborneFlights.map((flight) => (
            <Aircraft
              key={flight.aircraft_reg}
              flight={flight}
              progress={progressByReg[flight.aircraft_reg]}
              scale={1 / transform.k}
              showLabel={transform.k >= SHOW_AIRCRAFT_LABELS_AT_ZOOM}
              selected={flight === selectedFlight}
              onClick={() => selectAircraft(flight)}
            />
          ))}
        </g>
      </svg>

      <aside className="sidebar">
        <header className="panel title">
          <div>
            <h1>US Airspace</h1>
            <p>{AIRPORTS.length} airports · all 48 contiguous states</p>
          </div>
          <button
            className={analyticsOpen ? 'drawer-toggle open' : 'drawer-toggle'}
            onClick={() => setAnalyticsOpen((open) => !open)}
            aria-expanded={analyticsOpen}
            aria-controls="analytics"
            aria-label={analyticsOpen ? 'Hide analytics' : 'Show analytics'}
          >
            ▾
          </button>
        </header>

        <AnalyticsPanel
          open={analyticsOpen}
          timeZone={timeZone}
          simTime={clock.simTime}
          elapsed={clock.elapsed}
          airborne={airborneFlights.length}
          disruptionIndex={disruptionIndex}
          onReset={clock.reset}
        />
      </aside>

      <div className="zoom-buttons">
        <button onClick={zoomIn} aria-label="Zoom in">+</button>
        <button onClick={zoomOut} aria-label="Zoom out">−</button>
        <button onClick={resetView} aria-label="Reset view">⟲</button>
      </div>

      {selectedAirport && (
        <div className="panel info">
          <div className="info-code">
            {selectedAirport.iata} {selectedAirport.rank && <span>#{selectedAirport.rank}</span>}
          </div>
          <div>{selectedAirport.name}</div>
          <div className="muted">{selectedAirport.city}</div>
          <div className="muted mono">{formatLatLon([selectedAirport.lon, selectedAirport.lat])}</div>
        </div>
      )}

      {selectedFlight && (
        <AircraftInfo flight={selectedFlight} progress={progressByReg[selectedFlight.aircraft_reg]} />
      )}

      <footer className="panel status">
        <span>Zoom {transform.k.toFixed(1)}×</span>
        <span>{cursor ? formatLatLon(cursor) : '—'}</span>
        {aircraftError && <span className="error">Aircraft data unavailable</span>}
        <span className="legend">
          <i className="legend-outer" /> 30 NM
          <i className="legend-inner" /> 10 NM
        </span>
      </footer>
    </div>
  );
}

function formatLatLon([lon, lat]) {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(4)}° ${ns}   ${Math.abs(lon).toFixed(4)}° ${ew}`;
}
