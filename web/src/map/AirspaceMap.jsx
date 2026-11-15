import { useMemo, useRef, useState } from 'react';
import { pointer } from 'd3-selection';
import { AIRPORTS } from '../data/airports.js';
import { timeZoneAt } from '../data/timeZones.js';
import { WIDTH, HEIGHT, projection, paths } from './geography.js';
import { useZoom } from './useZoom.js';
import { useSimulationClock } from './useSimulationClock.js';
import { useAircraft } from './useAircraft.js';
import { agentPose, flownPath } from './flights.js';
import { isAirborne } from './flightStatus.js';
import { useAgentSimulation } from '../simulation/useAgentSimulation.js';
import { flightPhysics } from './physics.js';
import { SIMULATION_MS, scheduledDepartureMs } from '../simulation/timing.js';
import AirportMarker from './AirportMarker.jsx';
import Aircraft from './Aircraft.jsx';
import AircraftInfo from './AircraftInfo.jsx';
import RouteChangeOverlay from './RouteChangeOverlay.jsx';
import FlightTracker from './FlightTracker.jsx';
import AnalyticsPanel from './AnalyticsPanel.jsx';
import SimulationControls from './SimulationControls.jsx';
import SignalLayer from './SignalLayer.jsx';

// Airport (ATC node) positions never change, so project them once.
const ATC_POSITIONS = Object.fromEntries(AIRPORTS.map(airport =>
  [`atc:${airport.iata}`, projection([airport.lon, airport.lat])]));

const MAX_ZOOM = 60;
const SHOW_NAMES_AT_ZOOM = 6;
const SHOW_AIRCRAFT_LABELS_AT_ZOOM = 3;
const FOCUS_ZOOM = 14;
const TRACK_ZOOM = 4; // minimum zoom when jumping to a plane picked in the flight tracker
const SIM_SPEED = 60; // simulated seconds per real second at ×1 (1 real second = 1 simulated minute)
// Every catalogue airport is a candidate alternate (and gets an ATC agent) in the simulation.
const SIM_AIRPORTS = AIRPORTS.map(({ iata, lon, lat }) => ({ iata, lon, lat }));
// Plane-card disruptions start on the next 10 s tick, so the last tick of the run is too late.
const LAST_ACTION_MS = SIMULATION_MS - 10_000;

export default function AirspaceMap() {
  const svgRef = useRef(null);
  const { transform, zoomIn, zoomOut, reset, focus } = useZoom(svgRef, MAX_ZOOM);
  const clock = useSimulationClock(SIM_SPEED, 100);
  const { flights: loadedFlights, error: aircraftError } = useAircraft();
  const [settings, setSettings] = useState({ aircraftLimit: 100, outage: false, packetLoss: 0, delaySeconds: 0, travelSpeedPercent: 100,
    diversionPolicy: 'LANDNEARESTAIRPORT', aircraftRangeNm: 100, towerRangeNm: 100 });
  const [scenarioEvents, setScenarioEvents] = useState([]);
  const aircraftEventCounter = useRef(0);
  const flights = useMemo(() => loadedFlights.slice(0, settings.aircraftLimit)
    .map((flight, index) => ({ ...flight, agentId: `aircraft:${index}` })), [loadedFlights, settings.aircraftLimit]);
  const options = useMemo(() => ({
    seed: 42,
    airports: SIM_AIRPORTS,
    // Radio coverage in nautical miles, set from the analytics panel. See simulation/radio.js.
    radio: { aircraftRangeNm: settings.aircraftRangeNm, towerRangeNm: settings.towerRangeNm },
    rulebook: `DESTCLOSED: ${settings.diversionPolicy}`,
    disruptions: [
      ...(settings.outage ? [{ factor: 'ATC_LINK_OUTAGE', startMs: 0, endMs: 30 * 60_000 }] : []),
      { factor: 'PACKET_LOSS', startMs: 0, endMs: SIMULATION_MS, value: settings.packetLoss / 100 },
      { factor: 'DELIVERY_DELAY', startMs: 0, endMs: SIMULATION_MS, value: settings.delaySeconds * 1000 },
      { factor: 'REDUCED_SPEED', startMs: 0, endMs: SIMULATION_MS, value: settings.travelSpeedPercent / 100 },
      ...scenarioEvents,
    ],
  }), [settings, scenarioEvents]);
  const simulation = useAgentSimulation(flights, clock.elapsed, options);

  const [selectedAirport, setSelectedAirport] = useState(null);
  const [selectedId, setSelectedId] = useState(null); // journey ID, independent of registration
  const [cursor, setCursor] = useState(null); // [lon, lat] under the mouse
  const [analyticsOpen, setAnalyticsOpen] = useState(true);
  const [showSignals, setShowSignals] = useState(false); // live communication lines on the map

  const agentsById = Object.fromEntries((simulation.snapshot?.aircraft ?? []).map(agent => [agent.id, agent]));
  const completedElapsed = simulation.snapshot?.time ?? 0;
  // A flight appears once its scheduled departure time is reached. If ATC then holds it,
  // it stays visible at the airport so the delay can be seen.
  const visibleFlights = flights.filter(flight => agentsById[flight.agentId]
    && completedElapsed >= scheduledDepartureMs(flight));
  const selectedFlight = flights.find(flight => flight.agentId === selectedId);
  // Map position of any message endpoint: an airport's ATC, or a plane that is on the map.
  const visibleById = Object.fromEntries(visibleFlights.map(flight => [flight.agentId, flight]));
  const nodePosition = (id) => {
    if (id.startsWith('atc:')) return ATC_POSITIONS[id] ?? null;
    const flight = visibleById[id];
    return flight ? agentPose(flight, agentsById[id]).position : null;
  };
  const selectedAgent = selectedFlight ? agentsById[selectedFlight.agentId] : undefined;
  // Live altitude, speed and fuel for the info card. (Map positions apply the same speed
  // profile inside agentPose, so planes never need this per frame.)
  const selectedPhysics = selectedAgent ? flightPhysics(selectedFlight, selectedAgent) : undefined;
  const selectedTrack = selectedAgent ? flownPath(selectedFlight, selectedAgent) : null;
  // Airborne planes whose route or destination changed; the selected one also after landing.
  const routeChangeFlights = visibleFlights.filter(flight => {
    const agent = agentsById[flight.agentId];
    return (agent.diverted || agent.reroute)
      && (isAirborne(agent) || (flight === selectedFlight && agent.phase === 'ARRIVED'));
  });
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
  const disruptSelected = factor => {
    const agent = agentsById[selectedId];
    if (!selectedFlight || !agent || !['EN_ROUTE', 'AWAITING_ARRIVAL'].includes(agent.phase)
      || agent.diverted || completedElapsed >= LAST_ACTION_MS) return;
    const startMs = completedElapsed + 10_000;
    let id;
    do { id = `aircraft-action-${++aircraftEventCounter.current}`; } while (scenarioEvents.some(event => event.id === id));
    changeEvents([...scenarioEvents, { id, factor, startMs,
      endMs: Math.min(SIMULATION_MS, startMs + 30 * 60_000),
      agentId: factor === 'AIRPORT_CLOSURE' ? `atc:${selectedFlight.airport_dest}` : selectedId,
      value: factor === 'AIRPORT_CLOSURE' ? 1 : Math.min(0.8, Math.max(0.1, agent.progress + 0.1)),
    }], startMs);
  };

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

  // Picking a row in the tracker selects the plane and brings it to the middle of the screen.
  const trackAircraft = (flight) => {
    selectAircraft(flight);
    const agent = agentsById[flight.agentId];
    if (agent) focus(agentPose(flight, agent).position, Math.max(transform.k, TRACK_ZOOM));
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

          {/* Selected flight: faint trail already flown, plus its planned route if nothing changed. */}
          {selectedTrack && <path className="flown-track" d={selectedTrack} />}
          {selectedFlight && !selectedAgent?.diverted && !selectedAgent?.reroute && (
            <path className="route-selected" d={selectedFlight.routePath} />
          )}

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

          {/* Route changes: dashed = abandoned plan / previous airport, solid = current path. */}
          {routeChangeFlights.map(flight => (
            <RouteChangeOverlay
              key={`route-change:${flight.agentId}`}
              flight={flight}
              agent={agentsById[flight.agentId]}
              time={completedElapsed}
              scale={1 / transform.k}
              selected={flight === selectedFlight}
              showLabel={transform.k >= SHOW_AIRCRAFT_LABELS_AT_ZOOM}
              opacity={flight === selectedFlight ? 1 : 0.5}
            />
          ))}

          {/* Live messages between nodes, under the plane icons. */}
          {showSignals && (
            <SignalLayer
              signals={simulation.snapshot?.signals}
              time={completedElapsed}
              positionOf={nodePosition}
            />
          )}

          {/* Aircraft are drawn last so they sit on top of airports and routes. */}
          {visibleFlights.map((flight) => (
            <Aircraft
              key={flight.agentId}
              flight={flight}
              agent={agentsById[flight.agentId]}
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
          showSignals={showSignals}
          onShowSignalsChange={setShowSignals}
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

      {/* Right column: live flight tracker in the top corner, selected airport/aircraft card at the bottom. */}
      <div className="right-column">
        <FlightTracker
          flights={visibleFlights}
          agentsById={agentsById}
          selectedId={selectedId}
          onSelect={trackAircraft}
          time={completedElapsed}
        />

        {selectedAirport && (
          <div className="panel info">
            <div className="info-header">
              <div className="info-code">
                {selectedAirport.iata} {selectedAirport.rank && <span>#{selectedAirport.rank}</span>}
              </div>
              <button type="button" className="info-close" onClick={() => setSelectedAirport(null)}
                aria-label="Close airport details" title="Close">✕</button>
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
            physics={selectedPhysics}
            nameOf={id => agentsById[id]?.flightNumber ?? id}
            onDisrupt={disruptSelected}
            diversionPolicy={settings.diversionPolicy}
            canDisrupt={!simulation.busy && completedElapsed < LAST_ACTION_MS}
            onClose={() => setSelectedId(null)}
          />
        )}
      </div>

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
