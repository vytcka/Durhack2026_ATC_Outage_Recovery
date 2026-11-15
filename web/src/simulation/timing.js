// Synthetic no-disruption reference for the current protocol, not an airline schedule.
// One initial decision tick, four departure-message hops, then two arrival-message hops.
export function expectedTiming(flight, { tickMs, latencyMs }) {
  const hopMs = Math.max(1, Math.ceil(latencyMs / tickMs)) * tickMs;
  const expectedDepartureAt = tickMs + 4 * hopMs;
  const expectedTravelMs = Math.ceil(flight.est_flight_dur * 60_000 / tickMs) * tickMs;
  return {
    expectedDepartureAt,
    expectedArrivalAt: expectedDepartureAt + expectedTravelMs + 2 * hopMs,
    expectedArrivalWaitMs: 2 * hopMs,
  };
}

export function flightTiming(agent, time, options) {
  const reference = expectedTiming(agent.flight, options);
  const measuredAt = agent.arrivedAt ?? time;
  const departureDelayMs = Math.max(0, (agent.departedAt ?? measuredAt) - reference.expectedDepartureAt);
  const enRouteMs = agent.departedAt === null ? 0 : Math.max(0, (agent.arrivalRequestedAt ?? measuredAt) - agent.departedAt);
  const workMs = Math.min(agent.flight.est_flight_dur * 60_000, agent.travelWorkMs ?? enRouteMs);
  const nominalTravelMs = Math.ceil(workMs / options.tickMs) * options.tickMs;
  const travelDelayMs = Math.max(0, enRouteMs - nominalTravelMs);
  const arrivalDelayMs = agent.arrivalRequestedAt === null ? 0
    : Math.max(0, measuredAt - agent.arrivalRequestedAt - reference.expectedArrivalWaitMs);
  const totalDelayMs = departureDelayMs + travelDelayMs + arrivalDelayMs;
  return { ...reference, departureDelayMs, travelDelayMs, arrivalDelayMs, totalDelayMs, delayed: totalDelayMs > 0 };
}

export function formatDelay(ms) {
  if (ms === null || ms === undefined) return '—';
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

export function formatSimulationTime(ms) {
  if (ms === null || ms === undefined) return '—';
  const seconds = Math.floor(ms / 1000);
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map(part => String(part).padStart(2, '0')).join(':');
}
