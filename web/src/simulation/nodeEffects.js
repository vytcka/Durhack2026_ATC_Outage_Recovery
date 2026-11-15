export function nodeEffects(events, agent, time) {
  const controller = agent.kind === 'aircraft'
    ? `atc:${agent.departedAt === null ? agent.flight.airport_dep : (agent.arrivalAirport ?? agent.flight.airport_dest)}` : agent.id;

  const active = events.filter(event => event.startMs <= time && time < event.endMs
    && (!event.agentId || event.agentId === agent.id || event.agentId === controller));

  const result = {
    speedFactor: 1, climbFactor: 1, burnMultiplier: 1, reportAgeMs: 0, positionBias: 0,
    clockOffsetMs: 0, rangeFactor: 1, decisionDelayMs: 0, handover: false, noGoBoundary: Infinity,
    priority: false, closed: false, runwayClosed: false, arrivalIntervalMs: 0,
    alternateIntervalMs: 0, processingBudget: Infinity, backgroundDemand: 0,
  };
  for (const event of active) {
    const value = event.value;
    switch (event.factor) {
      case 'REDUCED_SPEED': result.speedFactor *= value; break;
      case 'HEADWIND': result.speedFactor *= 1 - value; break;
      case 'REDUCED_CLIMB': result.climbFactor *= value; break;
      case 'FUEL_CONSUMPTION': result.burnMultiplier *= value; break;
      case 'STALE_POSITION': result.reportAgeMs = Math.max(result.reportAgeMs, value); break;
      case 'POSITION_BIAS': result.positionBias += value; break;
      case 'CLOCK_OFFSET': result.clockOffsetMs += value; break;
      case 'OBSERVATION_RANGE': result.rangeFactor *= value; break;
      case 'DECISION_DELAY': result.decisionDelayMs = Math.max(result.decisionDelayMs, value); break;
      case 'HANDOVER_FAILURE': result.handover = true; break;
      case 'NO_GO_REGION': result.noGoBoundary = Math.min(result.noGoBoundary, value); break;
      case 'EMERGENCY_PRIORITY': result.priority = true; break;
      case 'AIRPORT_CLOSURE': result.closed = true; break;
      case 'RUNWAY_CLOSURE': result.runwayClosed = true; break;
      case 'CROSSWIND': result.runwayClosed ||= value >= 0.5; break;
      case 'ARRIVAL_CAPACITY': result.arrivalIntervalMs = Math.max(result.arrivalIntervalMs, 60_000 / value); break;
      case 'ALTERNATE_CAPACITY': result.alternateIntervalMs = Math.max(result.alternateIntervalMs, 60_000 / value); break;
      case 'ATC_BACKLOG': result.processingBudget = Math.min(result.processingBudget, value); break;
      case 'DEMAND_SURGE': result.backgroundDemand = Math.max(result.backgroundDemand, value); break;
      default: break;
    }
  }
  return result;
}
