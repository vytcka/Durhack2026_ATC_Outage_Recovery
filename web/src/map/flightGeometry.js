// Pure map-space geometry for drawing aircraft and their route changes.
// The geographic projection is injected by the caller so this module runs in Node
// without loading geography.js (which pulls in the atlas JSON).
import { routePose } from '../simulation/routeGeometry.js';
import { AIRPORT_BY_IATA } from '../data/airports.js';
import { routeFractionAt } from './physics.js';

export const isPoint = point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite);
const clamp01 = value => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
const headingOf = ([dx, dy]) => Math.atan2(dx, -dy) * 180 / Math.PI; // 0° = up, clockwise
const pathOf = points => points.map((point, index) => `${index ? 'L' : 'M'}${point}`).join(' ');

function validCurve(flight) {
  return Array.isArray(flight?.curve) && flight.curve.length === 3 && flight.curve.every(isPoint);
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

export function arcLengthTable(curve) {
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
export function curveParamAt(table, fraction) {
  const i = table.findIndex((value) => value >= fraction);
  if (i <= 0) return 0;

  // Interpolate linearly between the two samples around `fraction`.
  const within = (fraction - table[i - 1]) / (table[i] - table[i - 1]);
  return (i - 1 + within) / ARC_SAMPLES;
}

// Engine progress (share of flight TIME, 0..1) → Bézier parameter of the drawn curve, via the
// physics speed profile (slow near airports, fast in cruise) and the arc-length table.
// Flights without an arc-length table (bare test curves) map progress straight to t.
export function curveParam(flight, progress) {
  const p = clamp01(progress);
  if (!Array.isArray(flight?.arcLengths)) return p;
  return curveParamAt(flight.arcLengths, routeFractionAt(flight, p));
}

// A detour window is stored in engine progress. Map it into the same curve-parameter space as
// the plane, so the bypass bump starts exactly where the plane was when ATC approved it.
function curveReroute(flight, reroute) {
  if (!reroute) return undefined;
  if (!Array.isArray(flight?.arcLengths)) return reroute;
  return { ...reroute,
    startProgress: curveParam(flight, reroute.startProgress),
    endProgress: curveParam(flight, reroute.endProgress) };
}

// Point and heading on the (possibly detoured) route at engine progress `progress`.
export function routePoint(flight, progress, reroute) {
  return routePose(flight.curve, curveParam(flight, progress), curveReroute(flight, reroute));
}

// Positions along the route between engine progress `from` and `to`, with exact endpoints.
export function sampleRoute(flight, from, to, reroute, samples = 40) {
  const start = curveParam(flight, from);
  const end = curveParam(flight, to);
  const mapped = curveReroute(flight, reroute);
  return Array.from({ length: samples + 1 }, (_, index) => routePose(flight.curve,
    index === 0 ? start : index === samples ? end : start + (end - start) * index / samples, mapped).position);
}

// Map-space position of an airport from the diversion's coordinates, or the catalogue as a fallback.
function airportPoint(lonLat, iata, project) {
  if (!project) return null;
  if (isPoint(lonLat)) return project(lonLat);
  const airport = AIRPORT_BY_IATA[iata];
  return airport ? project([airport.lon, airport.lat]) : null;
}

// The straight diversion leg: from where the plane turned on its (possibly detoured) route
// to the new airport. Null unless the agent is diverted and both ends are known.
export function diversionLeg(flight, agent, project) {
  const diversion = agent?.diversion;
  if (!agent?.diverted || !diversion || !validCurve(flight)) return null;
  const turn = routePoint(flight, diversion.startProgress, diversion.reroute ?? undefined).position;
  const to = airportPoint(diversion.destination, diversion.airport ?? agent.arrivalAirport, project);
  if (!isPoint(turn) || !isPoint(to)) return null;
  return { turn, to };
}

// Where to draw the aircraft and which way its nose points.
// Normal / detour: along the curve (detour bump included). Diverted: straight from the turn
// point to the new airport, `agent.progress` being the fraction of that leg flown.
export function displayPose(flight, agent, project) {
  const leg = diversionLeg(flight, agent, project);
  if (leg) {
    const t = clamp01(agent.progress);
    const delta = [leg.to[0] - leg.turn[0], leg.to[1] - leg.turn[1]];
    const position = t >= 1 ? [...leg.to] : [leg.turn[0] + delta[0] * t, leg.turn[1] + delta[1] * t];
    const heading = Math.hypot(...delta) > 1e-9 ? headingOf(delta)
      : routePoint(flight, agent.diversion.startProgress, agent.diversion.reroute ?? undefined).heading;
    return { position, heading };
  }
  return routePoint(flight, agent?.progress, agent?.reroute ?? undefined);
}

// Path already flown by the selected aircraft: along the curve (including any detour) up to
// the current position, or up to the turn point and then straight along the diversion leg.
export function flownTrackPath(flight, agent, project, samples = 48) {
  if (!agent || agent.departedAt == null || !validCurve(flight)) return null;
  const leg = diversionLeg(flight, agent, project);
  const reroute = leg ? agent.diversion.reroute ?? undefined : agent.reroute ?? undefined;
  const end = leg ? agent.diversion.startProgress : agent.progress;
  const points = sampleRoute(flight, 0, end, reroute, samples);
  if (leg) points.push(displayPose(flight, agent, project).position);
  return points.length > 1 ? pathOf(points) : null;
}

export { pathOf };
