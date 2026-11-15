// Turning raw aircraft records into something we can draw.
import { AIRPORT_BY_IATA } from '../data/airports.js';
import { projection } from './geography.js';
import { arcLengthTable, displayPose, flownTrackPath } from './flightGeometry.js';

const MS_PER_MINUTE = 60_000;

// How far a route bows out sideways, as a fraction of its length. Real great circles look
// almost straight on this projection, so the curvature is exaggerated to read as "the globe".
const ROUTE_BEND = 0.2;

// Each route is a quadratic Bézier curve in map coordinates: start, end and one control point
// that pulls the middle of the line sideways. Records with an unknown airport are skipped.
export function prepareFlights(records) {
  return records.flatMap((record) => {
    const from = AIRPORT_BY_IATA[record.airport_dep];
    const to = AIRPORT_BY_IATA[record.airport_dest];

    if (!from || !to) {
      console.warn(`Skipping ${record.flight_number}: unknown airport ${record.airport_dep} → ${record.airport_dest}`);
      return [];
    }

    const start = projection([from.lon, from.lat]);
    const end = projection([to.lon, to.lat]);
    const control = controlPoint(start, end);
    const curve = [start, control, end];

    return [{
      ...record,
      from,
      to,
      curve,
      arcLengths: arcLengthTable(curve),
      routePath: `M${start} Q${control} ${end}`, // arrays stringify as "x,y"
    }];
  });
}

// Midpoint of the route pushed sideways, always towards the top of the map
// (northwards), the same way great circles bow towards the pole.
function controlPoint([x0, y0], [x1, y1]) {
  const dx = x1 - x0;
  const dy = y1 - y0;

  // (dy, -dx) is perpendicular to the route and as long as it. Flip it if it points down.
  const direction = dx >= 0 ? 1 : -1;

  return [
    (x0 + x1) / 2 + dy * direction * ROUTE_BEND,
    (y0 + y1) / 2 - dx * direction * ROUTE_BEND,
  ];
}

// 0 at departure, 1 on arrival.
export function flightProgress(flight, elapsedMs) {
  return Math.min(elapsedMs / (flight.est_flight_dur * MS_PER_MINUTE), 1);
}

export function minutesRemaining(flight, progress) {
  return Math.round(flight.est_flight_dur * (1 - progress));
}

// Pose of a simulated aircraft (0° = up, clockwise): along its route, eased by the physics
// speed profile and including any detour, or on its straight diversion leg to a new airport.
export function agentPose(flight, agent) {
  return displayPose(flight, agent, projection);
}

// Faint trail of where the aircraft has already been (selected aircraft only).
export function flownPath(flight, agent) {
  return flownTrackPath(flight, agent, projection);
}

const EARTH_RADIUS_NM = 3440.065;
const toRadians = degrees => degrees * Math.PI / 180;

function haversineNm([lon1, lat1], [lon2, lat2]) {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Nautical miles covered by one map unit around `position` (the conformal projection's local
// scale), for turning drawn distances into separation distances. NaN when off the projection.
export function nmPerMapUnit(position) {
  const here = projection.invert(position);
  const east = projection.invert([position[0] + 1, position[1]]);
  if (!here || !east || ![...here, ...east].every(Number.isFinite)) return NaN;
  return haversineNm(here, east);
}
