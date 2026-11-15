import { useMemo, useRef, useState } from 'react';
import { pointer } from 'd3-selection';
import { AIRPORTS } from '../data/airports.js';
import { timeZoneAt } from '../data/timeZones.js';
import { WIDTH, HEIGHT, projection, paths } from './geography.js';
import { useZoom } from './useZoom.js';
import { useSimulationClock } from './useSimulationClock.js';
import { useAircraft } from './useAircraft.js';
import { useAgentSimulation } from '../simulation/useAgentSimulation.js';
import { flightPhysics } from './physics.js';
import AirportMarker from './AirportMarker.jsx';
import Aircraft from './Aircraft.jsx';
import AircraftInfo from './AircraftInfo.jsx';
import AnalyticsPanel from './AnalyticsPanel.jsx';
import SimulationControls from './SimulationControls.jsx';

const MAX_ZOOM = 60;
const SHOW_NAMES_AT_ZOOM = 6;
const SHOW_AIRCRAFT_LABELS_AT_ZOOM = 3;
const FOCUS_ZOOM = 14;
const SIM_SPEED = 60; // simulated seconds per real second at ×1 (1 real second = 1 simulated minute)

export default function AirspaceMap() {
  const svgRef = useRef(null);
  const { transform, zoomIn, zoomOut, reset, focus } = useZoom(svgRef, MAX_ZOOM);
  const clock = useSimulationClock(SIM_SPEED, 100);
  const { flights: loadedFlights, error: aircraftError } = useAircraft();
  const [settings, setSettings] = useState({ aircraftLimit: 100, outage: false, packetLoss: 0, delaySeconds: 0, travelSpeedPercent: 100 });
  const [scenarioEvents, setScenarioEvents] = useState([]);
  const flights = useMemo(() => loadedFlights.slice(0, settings.aircraftLimit)
    .map((flight, index) => ({ ...flight, agentId: `aircraft:${index}` })), [loadedFlights, settings.aircraftLimit]);
  const options = useMemo(() => ({
    seed: 42,
    disruptions: [
      ...(settings.outage ? [{ factor: 'ATC_LINK_OUTAGE', startMs: 0, endMs: 30 * 60_000 }] : []),
      { factor: 'PACKET_LOSS', startMs: 0, endMs: 86_400_000, value: settings.packetLoss / 100 },
      { factor: 'DELIVERY_DELAY', startMs: 0, endMs: 86_400_000, value: settings.delaySeconds * 1000 },
      { factor: 'REDUCED_SPEED', startMs: 0, endMs: 86_400_000, value: settings.travelSpeedPercent / 100 },
      ...scenarioEvents,
    ],
  }), [settings, scenarioEvents]);
  const simulation = useAgentSimulation(flights, clock.elapsed, options);

  const [selectedAirport, setSelectedAirport] = useState(null);
  const [selectedId, setSelectedId] = useState(null); // journey ID, independent of registration
  const [cursor, setCursor] = useState(null); // [lon, lat] under the mouse
  const [analyticsOpen, setAnalyticsOpen] = useState(true);

  const agentsById = Object.fromEntries((simulation.snapshot?.aircraft ?? []).map(agent => [agent.id, agent]));
  const visibleFlights = flights.filter(flight => agentsById[flight.agentId]);
  // Live altitude, speed, fuel and position along the route for every flight on the map.
  const physicsById = Object.fromEntries(visibleFlights.map(flight =>
    [flight.agentId, flightPhysics(flight, agentsById[flight.agentId])]));
  const selectedFlight = flights.find(flight => flight.agentId === selectedId);
  const completedElapsed = simulation.snapshot?.time ?? 0;
  const completedSimTime = new Date(clock.simTime.getTime() - clock.elapsed + completedElapsed);
  const stats = simulation.snapshot?.stats;
  const disruptionIndex = stats?.sent ? stats.dropped / stats.sent : 0;
  const changeSettings = (next) => {
    clock.seek(0);
    if (next.aircraftLimit !== settings.aircraftLimit) setScenarioEvents([]);
    setSelectedId(null);
    setSettings(next);
  };
  const changeEvents = (next, seekTo = completedElapsed) => {
    clock.seek(seekTo);
    setScenarioEvents(next);
  };
  const scenarioAirports = [...new Set(flights.flatMap(flight => [flight.airport_dep, flight.airport_dest]))].sort();

  // The clock follows whatever is in the middle of the screen. The viewBox centre is also the
  // screen centre (the SVG scales uniformly), so undo the zoom transform, then the projection,
  // to get the [lon, lat] being looked at.
  const timeZone = useMemo(() => {
    const viewCenter = projection.invert(transform.invert([WIDTH / 2, HEIGHT / 2]));
    return timeZoneAt(viewCenter);
  }, [transform]);

  const selectAirport = (airport) => {
    setSelectedId(null);
    setSelectedAirport(airport);
    focus(projection([airport.lon, airport.lat]), FOCUS_ZOOM);
  };

  const selectAircraft = (flight) => {
    setSelectedAirport(null);
    setSelectedId(flight.agentId);
  };

  const resetView = () => {
    setSelectedAirport(null);
    setSelectedId(null);
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
          {visibleFlights.map((flight) => (
            <Aircraft
              key={flight.agentId}
              flight={flight}
              routeFraction={physicsById[flight.agentId].routeFraction}
              phase={agentsById[flight.agentId].phase}
              delayed={agentsById[flight.agentId].delayed}
              diverted={agentsById[flight.agentId].diverted}
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
          simTime={completedSimTime}
          elapsed={completedElapsed}
          airborne={stats?.airborne ?? 0}
          disruptionIndex={disruptionIndex}
          onReset={clock.reset}
          onSeek={clock.seek}
          simulation={simulation}
          settings={settings}
          onSettingsChange={changeSettings}
          scenarioEvents={scenarioEvents}
          onEventsChange={changeEvents}
          scenarioAircraft={flights.map(flight => ({ id: flight.agentId, flightNumber: flight.flight_number }))}
          scenarioAirports={scenarioAirports}
        />
      </aside>

      <SimulationControls
        multiplier={clock.multiplier}
        paused={clock.paused}
        onMultiplierChange={clock.setMultiplier}
        onTogglePause={clock.togglePause}
      />

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
        <AircraftInfo
          flight={selectedFlight}
          progress={agentsById[selectedFlight.agentId]?.progress ?? 0}
          agent={agentsById[selectedFlight.agentId]}
          physics={physicsById[selectedFlight.agentId]}
        />
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
