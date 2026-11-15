import { agentPose } from './flights.js';
import { flightStatus, FLIGHT_STATUS_BY_ID } from './flightStatus.js';
import { aircraftLabel } from './flightText.js';

const ICON_SIZE = 32.5; // on-screen size in px
const ICON_BOX = 64;    // size of the coordinate box the path below is drawn in

// Top-down Boeing 737 silhouette, nose pointing up, centred in a 64×64 box:
// narrow fuselage, swept wings, two underwing engines and a small tailplane.
const B737_PATH = [
  // Fuselage, wings and tailplane as one outline (right side first, then mirrored left side).
  'M32 2 C34 2 35 5 35 9 L35 24 L60 37 L60 40 L35 35 L35 49 L45 55 L45 58 L34 56 L33 62',
  'L31 62 L30 56 L19 58 L19 55 L29 49 L29 35 L4 40 L4 37 L29 24 L29 9 C29 5 30 2 32 2 Z',
  // Engines, slung forward of the wing.
  'M42 25 h4 v8 h-4 Z',
  'M18 25 h4 v8 h-4 Z',
].join(' ');

// One aircraft on the map. `agent` is its snapshot entry; `scale` is 1/zoom so the icon keeps
// the same size on screen. Colour comes from CSS via data-status (see flightStatus.js).
// agentPose places it by share of route DISTANCE (physics.js speed profile), not of time.
// `pose` (optional) is the pose already computed by the map, e.g. on a lost-comms holding orbit.
// `link` ({ state: 'live' | 'lost' | null, transmitting }) draws the radio-link symbol above it.
export default function Aircraft({ flight, agent, pose, link, scale, showLabel, selected, onClick }) {
  const { position: [x, y], heading } = pose ?? agentPose(flight, agent);
  const status = flightStatus(agent);
  const label = aircraftLabel(flight, agent);
  const radio = link?.state === 'lost' ? ' · communication lost' : link?.state === 'live' ? ' · in contact' : '';

  return (
    <g
      className={selected ? 'aircraft selected' : 'aircraft'}
      data-agent-id={flight.agentId}
      data-status={status}
      data-phase={agent?.phase}
      data-delayed={String(Boolean(agent?.delayed))}
      data-diverted={String(Boolean(agent?.diverted))}
      data-rerouted={String(Boolean(agent?.reroute))}
      data-nordo={String(agent?.phase !== 'ARRIVED' && agent?.squawk === '7600')}
      data-no-radio={String(agent?.radioPath === null)}
      transform={`translate(${x},${y}) scale(${scale})`}
      onClick={onClick}
    >
      <title>{label} · {FLIGHT_STATUS_BY_ID[status].label.toLowerCase()}{radio}</title>
      {/* Transforms apply right to left: centre the box on the origin, size it, then rotate. */}
      <path
        className="aircraft-icon"
        d={B737_PATH}
        transform={`rotate(${heading}) scale(${ICON_SIZE / ICON_BOX}) translate(${-ICON_BOX / 2},${-ICON_BOX / 2})`}
      />
      {link?.state && <LinkSymbol state={link.state} transmitting={link.transmitting} />}
      {(showLabel || selected) && (
        <text className="aircraft-label" x={20} y={-12}>
          {label}
        </text>
      )}
    </g>
  );
}

// Radio-link symbol above the plane, in screen pixels (the parent group is scaled by 1/zoom and
// never rotated): a broadcast emitter with two waves. Green = in contact (outer wave pulses
// while transmitting), red with a slash = communication lost.
function LinkSymbol({ state, transmitting }) {
  return (
    <g className="link-symbol" data-link={state} data-transmitting={String(Boolean(transmitting))}
      transform="translate(0,-25)" aria-hidden="true">
      <circle className="link-badge" r={7.5} />
      <circle className="link-emitter" r={1.6} />
      <path className="link-wave" d="M-2.6 -2.6 A3.7 3.7 0 0 0 -2.6 2.6 M2.6 -2.6 A3.7 3.7 0 0 1 2.6 2.6" />
      <path className="link-wave link-wave-outer" d="M-4.6 -4.6 A6.5 6.5 0 0 0 -4.6 4.6 M4.6 -4.6 A6.5 6.5 0 0 1 4.6 4.6" />
      {state === 'lost' && <path className="link-slash" d="M-5.3 5.3 L5.3 -5.3" />}
    </g>
  );
}
