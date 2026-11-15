// Storm cells as the engine models them. A NO_GO_REGION event closes one aircraft's route from
// `value` (share of the route) onward: the plane holds at that edge, asks its destination ATC
// for a bypass, then flies the longer detour. There is no weather polygon, so the region is drawn
// as a closed corridor along the ORIGINAL route from the edge, which the violet detour arcs around.
// Pure: positions come from flightGeometry, so the region always lines up with the drawn plane.
import { isPoint, pathOf, routePoint, sampleRoute } from './flightGeometry.js';
import { formatSimulationTime } from '../simulation/timing.js';

// How much of the route after the edge the corridor covers (share of route), and samples.
const CORRIDOR_SPAN = 0.3;
const CORRIDOR_SAMPLES = 24;

export const REGION_STATUS_TEXT = {
  ahead: 'ahead: the route closes before the plane gets there',
  holding: 'holding at the edge while ATC negotiates a detour',
  bypassed: 'detour approved: flying the longer bypass',
};

// What the plane is doing about this region right now.
export function regionStatus(agent, boundary) {
  if (agent?.reroute && agent.reroute.boundary === boundary) return 'bypassed';
  if (agent?.phase === 'EN_ROUTE' && Number.isFinite(agent.progress) && agent.progress >= boundary - 0.005) return 'holding';
  return 'ahead';
}

/**
 * Closed-corridor descriptors for every active storm affecting a drawn flight.
 * @param flights map flights (with curve; arcLengths optional)
 * @param agentsById snapshot aircraft by id (uses activeFactors, phase, progress, reroute, diverted)
 * @param eventsById engine events by id, for the end time (optional)
 */
export function stormRegions(flights, agentsById, eventsById = {}) {
  const regions = [];
  for (const flight of flights) {
    const agent = agentsById?.[flight.agentId];
    // A diverted plane has left the route; a landed one no longer cares.
    if (!agent || agent.diverted || agent.phase === 'ARRIVED') continue;
    for (const factor of agent.activeFactors ?? []) {
      if (factor.factor !== 'NO_GO_REGION' || !Number.isFinite(factor.value)) continue;
      const boundary = Math.min(0.98, Math.max(0, factor.value));
      const edge = routePoint(flight, boundary);
      const corridor = sampleRoute(flight, boundary, Math.min(0.98, boundary + CORRIDOR_SPAN), undefined, CORRIDOR_SAMPLES);
      if (!isPoint(edge.position) || !corridor.every(isPoint)) continue;
      const status = regionStatus(agent, boundary);
      const endMs = eventsById[factor.id]?.endMs;
      regions.push({
        id: `${factor.id}:${flight.agentId}`,
        agentId: flight.agentId,
        flightNumber: flight.flight_number,
        eventId: factor.id,
        boundary,
        edge: edge.position,
        // The edge bar is drawn across the route, so it is perpendicular to the heading there.
        edgeAngle: edge.heading,
        corridorPath: pathOf(corridor),
        status,
        label: `Storm · ${flight.flight_number} route closed from ${Math.round(boundary * 100)}%`,
        detail: `${REGION_STATUS_TEXT[status]}${Number.isFinite(endMs) ? ` · clears ${formatSimulationTime(endMs).slice(0, 5)}` : ''}`,
      });
    }
  }
  return regions;
}
