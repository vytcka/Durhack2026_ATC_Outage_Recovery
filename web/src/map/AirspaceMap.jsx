import { useMemo, useRef, useState } from 'react';
import { pointer } from 'd3-selection';
import { AIRPORTS } from '../data/airports.js';
import { timeZoneAt } from '../data/timeZones.js';
import { WIDTH, HEIGHT, projection, paths } from './geography.js';
import { useZoom } from './useZoom.js';
import { useSimulationClock } from './useSimulationClock.js';
import { useAircraft } from './useAircraft.js';
import { agentPose, flownPath, nmPerMapUnit } from './flights.js';
import { isAirborne } from './flightStatus.js';
import { detectCloseCalls } from './closeCalls.js';
import { ORBIT_RADIUS_NM, activeProcedureStep, holdingOrbit, isOrbiting } from './holdingPattern.js';
import { linkState, summariseComms, trafficByAgent } from './commsLinks.js';
import { useAgentSimulation } from '../simulation/useAgentSimulation.js';
import { generateAutoDisruptions } from '../simulation/autoDisruptions.js';
import { SUGGESTED_PROCEDURE_TEXT, parseProcedure } from '../simulation/procedures.js';
import { flightPhysics } from './physics.js';
import { SIMULATION_MS, scheduledDepartureMs } from '../simulation/timing.js';
import AirportMarker from './AirportMarker.jsx';
import Aircraft from './Aircraft.jsx';
import AircraftInfo from './AircraftInfo.jsx';
import RouteChangeOverlay from './RouteChangeOverlay.jsx';
import CloseCallsOverlay from './CloseCallsOverlay.jsx';
import RegionsOverlay from './RegionsOverlay.jsx';
import MapKey from './MapKey.jsx';
import { stormRegions } from './regions.js';
import FlightTracker from './FlightTracker.jsx';
import AnalyticsPanel from './AnalyticsPanel.jsx';
import SimulationControls from './SimulationControls.jsx';

const MAX_ZOOM = 60;
const SHOW_NAMES_AT_ZOOM = 6;
const SHOW_AIRCRAFT_LABELS_AT_ZOOM = 3;
const FOCUS_ZOOM = 14;
const TRACK_ZOOM = 4; // minimum zoom when jumping to a plane picked in the flight tracker
const SIM_SPEED = 60; // simulated seconds per real second at ×1 (1 real second = 1 simulated minute)
const SIM_SEED = 42;
// Every catalogue airport is a candidate alternate (and gets an ATC agent) in the simulation.
const SIM_AIRPORTS = AIRPORTS.map(({ iata, lon, lat }) => ({ iata, lon, lat }));
// Plane-card disruptions start on the next 10 s tick, so the last tick of the run is too late.
const LAST_ACTION_MS = SIMULATION_MS - 10_000;
// Planes still on the runway are not separation traffic.
const MIN_TRACK_ALTITUDE_FT = 200;

// A procedure text the engine will accept, or null (empty or invalid text is left out).
function validProcedureText(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  try {
    return parseProcedure(text).length ? text : null;
  } catch {
    return null;
  }
}

export default function AirspaceMap() {
  const svgRef = useRef(null);
  const { transform, zoomIn, zoomOut, reset, focus } = useZoom(svgRef, MAX_ZOOM);
  const clock = useSimulationClock(SIM_SPEED, 100);
  const { flights: loadedFlights, error: aircraftError } = useAircraft();
  const [settings, setSettings] = useState({ aircraftLimit: 100, outage: false, packetLoss: 0, delaySeconds: 0, travelSpeedPercent: 100,
    diversionPolicy: 'LANDNEARESTAIRPORT', autoDisruptions: 'moderate' });
  const [scenarioEvents, setScenarioEvents] = useState([]);
  // Applied lost-comms procedures: one for every aircraft plus per-aircraft overrides (text, see procedures.js).
  // The suggested protocol is in effect from the start; clearing it falls back to the rulebook default.
  const [procedures, setProcedures] = useState({ default: SUGGESTED_PROCEDURE_TEXT, byAgent: {} });
  const [layers, setLayers] = useState({ comms: true, closeCalls: true });
  const aircraftEventCounter = useRef(0);
  const flights = useMemo(() => loadedFlights.slice(0, settings.aircraftLimit)
    .map((flight, index) => ({ ...flight, agentId: `aircraft:${index}` })), [loadedFlights, settings.aircraftLimit]);
  // Seeded background disruptions (storm cells, headwinds, closures, outages, …) so a run is never uneventful.
  const autoEvents = useMemo(() => generateAutoDisruptions(flights, { seed: SIM_SEED, level: settings.autoDisruptions }),
    [flights, settings.autoDisruptions]);
  // Only valid, non-empty texts for aircraft that exist reach the engine (it would reject anything else).
  const engineProcedures = useMemo(() => {
    const ids = new Set(flights.map(flight => flight.agentId));
    const byAgent = Object.fromEntries(Object.entries(procedures.byAgent)
      .filter(([id]) => ids.has(id))
      .map(([id, text]) => [id, validProcedureText(text)])
      .filter(([, text]) => text));
    const fallback = validProcedureText(procedures.default);
    if (!fallback && !Object.keys(byAgent).length) return undefined;
    return { ...(fallback ? { default: fallback } : {}), ...(Object.keys(byAgent).length ? { byAgent } : {}) };
  }, [procedures, flights]);
  const options = useMemo(() => ({
    seed: SIM_SEED,
    airports: SIM_AIRPORTS,
    rulebook: `DESTCLOSED: ${settings.diversionPolicy}`,
    ...(engineProcedures ? { procedures: engineProcedures } : {}),
    disruptions: [
      ...(settings.outage ? [{ factor: 'ATC_LINK_OUTAGE', startMs: 0, endMs: 30 * 60_000 }] : []),
      { factor: 'PACKET_LOSS', startMs: 0, endMs: SIMULATION_MS, value: settings.packetLoss / 100 },
      { factor: 'DELIVERY_DELAY', startMs: 0, endMs: SIMULATION_MS, value: settings.delaySeconds * 1000 },
      { factor: 'REDUCED_SPEED', startMs: 0, endMs: SIMULATION_MS, value: settings.travelSpeedPercent / 100 },
      ...autoEvents,
      ...scenarioEvents,
    ],
  }), [settings, scenarioEvents, autoEvents, engineProcedures]);
  // Events by id, so a storm region can say when it clears.
  const eventsById = useMemo(() => Object.fromEntries(options.disruptions
    .filter(event => event.id).map(event => [event.id, event])), [options]);
  const simulation = useAgentSimulation(flights, clock.elapsed, options);

  const [selectedAirport, setSelectedAirport] = useState(null);
  const [selectedId, setSelectedId] = useState(null); // journey ID, independent of registration
  const [cursor, setCursor] = useState(null); // [lon, lat] under the mouse
  const [analyticsOpen, setAnalyticsOpen] = useState(true);

  const agentsById = Object.fromEntries((simulation.snapshot?.aircraft ?? []).map(agent => [agent.id, agent]));
  const completedElapsed = simulation.snapshot?.time ?? 0;
  // A flight appears once its scheduled departure time is reached. If ATC then holds it,
  // it stays visible at the airport so the delay can be seen.
  const visibleFlights = flights.filter(flight => agentsById[flight.agentId]
    && completedElapsed >= scheduledDepartureMs(flight));
  // Where each visible plane is drawn and what it is doing (altitude, speed, vertical rate), computed once
  // per render and shared by the icons, the close-call monitor and the communication links.
  const posesById = {};
  const physicsById = {};
  const orbits = []; // lost-comms holding circles (CircleAround / Hold blocks)
  for (const flight of visibleFlights) {
    const agent = agentsById[flight.agentId];
    let pose = agentPose(flight, agent);
    if (isOrbiting(agent)) {
      // Route progress is frozen at the hold point; fly the icon round a ~5 NM circle from there.
      const orbit = holdingOrbit(pose, {
        radiusUnits: ORBIT_RADIUS_NM / nmPerMapUnit(pose.position),
        elapsedMs: completedElapsed - (activeProcedureStep(agent)?.startedAt ?? completedElapsed),
      });
      if (orbit) {
        orbits.push({ id: flight.agentId, ...orbit });
        pose = { position: orbit.position, heading: orbit.heading };
      }
    }
    posesById[flight.agentId] = pose;
    physicsById[flight.agentId] = flightPhysics(flight, agent);
  }
  const tracks = visibleFlights.flatMap(flight => {
    const agent = agentsById[flight.agentId];
    const physics = physicsById[flight.agentId];
    if (!isAirborne(agent) || !(physics.altitudeFt >= MIN_TRACK_ALTITUDE_FT)) return [];
    const { position, heading } = posesById[flight.agentId];
    return [{ id: flight.agentId, position, heading, speedKt: physics.groundSpeedKt, altitudeFt: physics.altitudeFt,
      verticalRate: physics.verticalRate, nmPerUnit: nmPerMapUnit(position) }];
  });
  const closeCalls = detectCloseCalls(tracks);
  const comms = simulation.snapshot?.comms ?? [];
  const commsSummary = summariseComms(comms);
  // Who exchanged or lost a message this tick, for the radio-link symbol above each plane.
  const traffic = trafficByAgent(comms);

  const selectedFlight = flights.find(flight => flight.agentId === selectedId);
  const selectedAgent = selectedFlight ? agentsById[selectedFlight.agentId] : undefined;
  // Live altitude, speed and fuel for the info card.
  const selectedPhysics = selectedAgent
    ? physicsById[selectedFlight.agentId] ?? flightPhysics(selectedFlight, selectedAgent) : undefined;
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
  // Like scenario events, a new procedure replays the run to the current time and pauses there.
  const changeProcedures = (next) => {
    clock.seek(completedElapsed);
    setProcedures(next);
  };
  const changeAircraftProcedure = (agentId, text) => changeProcedures({
    ...procedures, byAgent: { ...procedures.byAgent, [agentId]: text },
  });
  const scenarioAirports = [...new Set(flights.flatMap(flight => [flight.airport_dep, flight.airport_dest]))].sort();
  // Plane-card actions add real scenario events at the next tick (then pause), never forced states.
  const disruptSelected = factor => {
    const agent = agentsById[selectedId];
    if (!selectedFlight || !agent || !isAirborne(agent) || completedElapsed >= LAST_ACTION_MS) return;
    if (agent.diverted && factor !== 'ATC_LINK_OUTAGE') return;
    const startMs = completedElapsed + 10_000;
    let id;
    do { id = `aircraft-action-${++aircraftEventCounter.current}`; } while (scenarioEvents.some(event => event.id === id));
    const shape = factor === 'AIRPORT_CLOSURE' ? { agentId: `atc:${selectedFlight.airport_dest}`, value: 1, minutes: 30 }
      // Radio failure between this aircraft and every ATC; peers can still relay for it.
      : factor === 'ATC_LINK_OUTAGE' ? { agentId: selectedId, value: 1, minutes: 15 }
        : { agentId: selectedId, value: Math.min(0.8, Math.max(0.1, agent.progress + 0.1)), minutes: 30 };
    changeEvents([...scenarioEvents, { id, factor, startMs,
      endMs: Math.min(SIMULATION_MS, startMs + shape.minutes * 60_000),
      agentId: shape.agentId, value: shape.value,
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
    if (agent) focus((posesById[flight.agentId] ?? agentPose(flight, agent)).position, Math.max(transform.k, TRACK_ZOOM));
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

  const toggleLayer = key => setLayers(current => ({ ...current, [key]: !current[key] }));
  const scale = 1 / transform.k;
  const showLabels = transform.k >= SHOW_AIRCRAFT_LABELS_AT_ZOOM;

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
              scale={scale}
              showName={transform.k >= SHOW_NAMES_AT_ZOOM}
              selected={airport === selectedAirport}
              onClick={() => selectAirport(airport)}
            />
          ))}

          {/* Storm cells: the closed stretch of each affected route; detours are drawn over them. */}
          <RegionsOverlay regions={stormRegions(visibleFlights, agentsById, eventsById)}
            scale={scale} showLabels={showLabels} selectedId={selectedId} />

          {/* Route changes: dashed = abandoned plan / previous airport, solid = current path. */}
          {routeChangeFlights.map(flight => (
            <RouteChangeOverlay
              key={`route-change:${flight.agentId}`}
              flight={flight}
              agent={agentsById[flight.agentId]}
              time={completedElapsed}
              scale={scale}
              selected={flight === selectedFlight}
              showLabel={showLabels}
              opacity={flight === selectedFlight ? 1 : 0.5}
            />
          ))}

          {/* Lost-comms holding orbits: the plane circles here until its block runs out or contact returns. */}
          {orbits.map(orbit => (
            <circle key={`orbit:${orbit.id}`} className={`holding-orbit${orbit.id === selectedId ? ' is-selected' : ''}`}
              cx={orbit.center[0]} cy={orbit.center[1]} r={orbit.radius} pointerEvents="none" aria-hidden="true" />
          ))}

          {/* Planes closer than the separation minima now, or about to be. */}
          {layers.closeCalls && (
            <CloseCallsOverlay calls={closeCalls} scale={scale} showLabels={showLabels} selectedId={selectedId} />
          )}

          {/* Aircraft are drawn last so they sit on top of airports and routes. */}
          {visibleFlights.map((flight) => (
            <Aircraft
              key={flight.agentId}
              flight={flight}
              agent={agentsById[flight.agentId]}
              pose={posesById[flight.agentId]}
              link={layers.comms ? linkState(agentsById[flight.agentId], traffic.get(flight.agentId)) : null}
              scale={scale}
              showLabel={showLabels}
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
          autoEvents={autoEvents}
          closeCallCount={closeCalls.length}
          lossCount={closeCalls.filter(call => call.kind === 'loss').length}
          commsSummary={commsSummary}
          procedures={procedures}
          onProceduresChange={changeProcedures}
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

      {/* Right column: live flight tracker on top, selected airport/aircraft card at the bottom. */}
      <div className="right-column">
        <FlightTracker
          flights={visibleFlights}
          agentsById={agentsById}
          selectedId={selectedId}
          onSelect={trackAircraft}
          time={completedElapsed}
          closeCalls={closeCalls}
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
            key={selectedFlight.agentId}
            flight={selectedFlight}
            progress={selectedAgent?.progress ?? 0}
            agent={selectedAgent}
            physics={selectedPhysics}
            onDisrupt={disruptSelected}
            diversionPolicy={settings.diversionPolicy}
            canDisrupt={!simulation.busy && completedElapsed < LAST_ACTION_MS}
            onClose={() => setSelectedId(null)}
            closeCalls={closeCalls}
            nameOf={id => flights.find(flight => flight.agentId === id)?.flight_number /* undefined → formatter's own ATC naming */}
            procedureText={procedures.byAgent[selectedFlight.agentId] ?? ''}
            defaultProcedureText={procedures.default}
            onProcedureChange={text => changeAircraftProcedure(selectedFlight.agentId, text)}
            time={completedElapsed}
          />
        )}
      </div>

      <footer className="panel status">
        <span>Zoom {transform.k.toFixed(1)}×</span>
        <span>{cursor ? formatLatLon(cursor) : '—'}</span>
        {aircraftError && <span className="error">Aircraft data unavailable</span>}
        <span className="layer-toggles" role="group" aria-label="Map layers">
          <label title="Radio symbol above each aircraft: green in contact, red communication lost. The number is messages in flight.">
            <input type="checkbox" checked={layers.comms} onChange={() => toggleLayer('comms')} />
            Radio <span className="mono">{commsSummary.inFlight}</span>
            {commsSummary.dropped > 0 && <span className="layer-alert mono" title="Dropped this tick"> ✕{commsSummary.dropped}</span>}
          </label>
          <label title="Pairs closer than 5 NM / 1,000 ft, or about to be within 3 minutes"
            data-alert={String(closeCalls.length > 0)}>
            <input type="checkbox" checked={layers.closeCalls} onChange={() => toggleLayer('closeCalls')} />
            Close calls <span className="mono">{closeCalls.length}</span>
          </label>
        </span>
        {/* Explains every region and line drawn on the map; the panel opens above the footer. */}
        <MapKey />
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
