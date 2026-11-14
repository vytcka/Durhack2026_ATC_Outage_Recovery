import { useMemo, useRef, useState } from 'react';
import { pointer } from 'd3-selection';
import { AIRPORTS } from '../data/airports.js';
import { timeZoneAt } from '../data/timeZones.js';
import { WIDTH, HEIGHT, projection, paths } from './geography.js';
import { useZoom } from './useZoom.js';
import AirportMarker from './AirportMarker.jsx';
import AnalyticsPanel from './AnalyticsPanel.jsx';

const MAX_ZOOM = 60;
const SHOW_NAMES_AT_ZOOM = 6;
const FOCUS_ZOOM = 14;
const SIM_SPEED = 60; // simulated seconds per real second (1 real second = 1 simulated minute)

export default function AirspaceMap() {
  const svgRef = useRef(null);
  const { transform, zoomIn, zoomOut, reset, focus } = useZoom(svgRef, MAX_ZOOM);
  const [selected, setSelected] = useState(null);
  const [cursor, setCursor] = useState(null); // [lon, lat] under the mouse
  const [analyticsOpen, setAnalyticsOpen] = useState(true);

  // TODO: replace with real values once the simulation is connected.
  const [simStartedAt] = useState(() => Date.now());
  const airborne = 0;
  const disruptionIndex = 0;

  // The clock follows whatever is in the middle of the screen. The viewBox centre is also the
  // screen centre (the SVG scales uniformly), so undo the zoom transform, then the projection,
  // to get the [lon, lat] being looked at.
  const timeZone = useMemo(() => {
    const viewCenter = projection.invert(transform.invert([WIDTH / 2, HEIGHT / 2]));
    return timeZoneAt(viewCenter);
  }, [transform]);

  const selectAirport = (airport) => {
    setSelected(airport);
    focus(projection([airport.lon, airport.lat]), FOCUS_ZOOM);
  };

  const resetView = () => {
    setSelected(null);
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

          {AIRPORTS.map((airport) => (
            <AirportMarker
              key={airport.iata}
              airport={airport}
              position={projection([airport.lon, airport.lat])}
              scale={1 / transform.k}
              showName={transform.k >= SHOW_NAMES_AT_ZOOM}
              selected={airport === selected}
              onClick={() => selectAirport(airport)}
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
          startedAt={simStartedAt}
          speed={SIM_SPEED}
          airborne={airborne}
          disruptionIndex={disruptionIndex}
        />
      </aside>

      <div className="zoom-buttons">
        <button onClick={zoomIn} aria-label="Zoom in">+</button>
        <button onClick={zoomOut} aria-label="Zoom out">−</button>
        <button onClick={resetView} aria-label="Reset view">⟲</button>
      </div>

      {selected && (
        <div className="panel info">
          <div className="info-code">
            {selected.iata} {selected.rank && <span>#{selected.rank}</span>}
          </div>
          <div>{selected.name}</div>
          <div className="muted">{selected.city}</div>
          <div className="muted mono">{formatLatLon([selected.lon, selected.lat])}</div>
        </div>
      )}

      <footer className="panel status">
        <span>Zoom {transform.k.toFixed(1)}×</span>
        <span>{cursor ? formatLatLon(cursor) : '—'}</span>
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
