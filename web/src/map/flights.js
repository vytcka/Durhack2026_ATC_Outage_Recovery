// Turning raw aircraft records into something we can draw.
import { AIRPORT_BY_IATA } from '../data/airports.js';
import { projection } from './geography.js';

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

// Standard quadratic Bézier formula: the point at curve parameter t.
function bezierPoint([[x0, y0], [x1, y1], [x2, y2]], t) {
  const u = 1 - t;
  return [
    u * u * x0 + 2 * u * t * x1 + t * t * x2,
    u * u * y0 + 2 * u * t * y1 + t * t * y2,
  ];
}

// The Bézier parameter t doesn't advance at a constant rate along the curve, so a plane moved by
// t would speed up and slow down on its own. This table stores the share of the route length
// reached at evenly spaced t values, so we can go from "fraction of distance" back to t.
const ARC_SAMPLES = 50;

function arcLengthTable(curve) {
  const lengths = [0];
  let previous = bezierPoint(curve, 0);

  for (let i = 1; i <= ARC_SAMPLES; i++) {
    const point = bezierPoint(curve, i / ARC_SAMPLES);
    lengths.push(lengths[i - 1] + Math.hypot(point[0] - previous[0], point[1] - previous[1]));
    previous = point;
  }

  const total = lengths[ARC_SAMPLES];
  return lengths.map((length) => length / total);
}

// Inverse of the table: the t at which the given fraction of the route length is reached.
function curveParamAt(table, fraction) {
  const i = table.findIndex((value) => value >= fraction);
  if (i <= 0) return 0;

  // Interpolate linearly between the two samples around `fraction`.
  const within = (fraction - table[i - 1]) / (table[i] - table[i - 1]);
  return (i - 1 + within) / ARC_SAMPLES;
}

// Position at the given fraction of the route distance, and the heading (0° = up, clockwise).
export function aircraftPose(flight, routeFraction) {
  const t = curveParamAt(flight.arcLengths, routeFraction);
  const [[x0, y0], [x1, y1], [x2, y2]] = flight.curve;
  const u = 1 - t;

  // The curve's derivative is the direction of travel. Screen y grows downwards, hence -dy.
  const dx = 2 * u * (x1 - x0) + 2 * t * (x2 - x1);
  const dy = 2 * u * (y1 - y0) + 2 * t * (y2 - y1);
  const heading = (Math.atan2(dx, -dy) * 180) / Math.PI;

  return { position: bezierPoint(flight.curve, t), heading };
}
