import { routePose } from './routeGeometry.js';

// Local approximate geometry; no live airport availability is consulted here.
// A diverted aircraft flies a straight leg from where it turned to its alternate airport.
export function aircraftPosition(agent) {
  if (agent.diverted && agent.diversion) {
    const { fromPosition, destination } = agent.diversion;
    const t = diversionFraction(agent);
    if (t >= 1) return [...destination];
    return fromPosition.map((value, index) => value + (destination[index] - value) * t);
  }
  const from = agent.flight.origin ?? [0, 0];
  const to = agent.flight.destination ?? from;
  const midpoint = from.map((value, index) => (value + to[index]) / 2);
  return routePose([from, midpoint, to], agent.progress, agent.reroute).position;
}

// 0 at the turn towards the alternate, 1 on reaching it.
export function diversionFraction(agent) {
  return Math.min(1, Math.max(0, (agent.travelWorkMs - agent.diversion.startWorkMs) / agent.diversion.durationMs));
}

export function approximateDistance(first, second) {
  return Math.hypot((first[0] - second[0]) * Math.cos(first[1] * Math.PI / 180), first[1] - second[1]);
}

// Nearest locally known airport other than the original destination and any airport whose
// closure has been communicated to this aircraft. Ties break alphabetically for replay stability.
export function chooseAlternate(agent, action) {
  if (action !== 'LANDNEARESTAIRPORT') return agent.flight.airport_dep;
  const position = aircraftPosition(agent);
  const candidates = (agent.knownAirports ?? []).filter(airport => airport.iata !== agent.flight.airport_dest
    && !agent.unavailableAirports?.[airport.iata]);
  candidates.sort((a, b) => approximateDistance(position, [a.lon, a.lat]) - approximateDistance(position, [b.lon, b.lat])
    || a.iata.localeCompare(b.iata));
  return candidates[0]?.iata ?? null;
}
