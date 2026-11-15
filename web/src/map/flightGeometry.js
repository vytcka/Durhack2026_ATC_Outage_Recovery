// Pure map-space geometry for drawing aircraft and their route changes.
// The geographic projection is injected by the caller so this module runs in Node
// without loading geography.js (which pulls in the atlas JSON).
import { routePose } from '../simulation/routeGeometry.js';
import { AIRPORT_BY_IATA } from '../data/airports.js';

export const isPoint = point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite);
const clamp01 = value => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
const headingOf = ([dx, dy]) => Math.atan2(dx, -dy) * 180 / Math.PI; // 0° = up, clockwise
const pathOf = points => points.map((point, index) => `${index ? 'L' : 'M'}${point}`).join(' ');

function validCurve(flight) {
  return Array.isArray(flight?.curve) && flight.curve.length === 3 && flight.curve.every(isPoint);
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
  const turn = routePose(flight.curve, clamp01(diversion.startProgress), diversion.reroute ?? undefined).position;
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
      : routePose(flight.curve, clamp01(agent.diversion.startProgress), agent.diversion.reroute ?? undefined).heading;
    return { position, heading };
  }
  return routePose(flight.curve, clamp01(agent?.progress), agent?.reroute ?? undefined);
}

// Path already flown by the selected aircraft: along the curve (including any detour) up to
// the current position, or up to the turn point and then straight along the diversion leg.
export function flownTrackPath(flight, agent, project, samples = 48) {
  if (!agent || agent.departedAt == null || !validCurve(flight)) return null;
  const leg = diversionLeg(flight, agent, project);
  const reroute = leg ? agent.diversion.reroute ?? undefined : agent.reroute ?? undefined;
  const end = leg ? clamp01(agent.diversion.startProgress) : clamp01(agent.progress);
  const points = sampleRange(flight.curve, 0, end, reroute, samples);
  if (leg) points.push(displayPose(flight, agent, project).position);
  return points.length > 1 ? pathOf(points) : null;
}

// Positions along the curve from progress `from` to `to`, with exact endpoints.
export function sampleRange(curve, from, to, reroute, samples = 40) {
  return Array.from({ length: samples + 1 }, (_, index) => routePose(curve,
    index === 0 ? from : index === samples ? to : from + (to - from) * index / samples, reroute).position);
}

export { pathOf };
