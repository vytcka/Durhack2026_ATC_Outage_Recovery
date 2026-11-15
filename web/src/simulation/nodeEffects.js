export function nodeEffects(events, agent, time) {
  const controller = agent.kind === 'aircraft'
    ? `atc:${agent.departedAt === null ? agent.flight.airport_dep : (agent.arrivalAirport ?? agent.flight.airport_dest)}` : agent.id;
  const active = events.filter(event => event.startMs <= time && time < event.endMs
    && (!event.agentId || event.agentId === agent.id || event.agentId === controller));
  const values = id => active.filter(event => event.factor === id).map(event => event.value);
  const max = (id, fallback = 0) => Math.max(fallback, ...values(id));
  const min = (id, fallback = Infinity) => Math.min(fallback, ...values(id));
  const product = id => values(id).reduce((a, b) => a * b, 1);
  return {
    active, speedFactor: product('REDUCED_SPEED') * values('HEADWIND').reduce((a, b) => a * (1 - b), 1),
    climbFactor: product('REDUCED_CLIMB'), burnMultiplier: product('FUEL_CONSUMPTION'),
    reportAgeMs: max('STALE_POSITION'), positionBias: values('POSITION_BIAS').reduce((a, b) => a + b, 0),
    clockOffsetMs: values('CLOCK_OFFSET').reduce((a, b) => a + b, 0),
    rangeFactor: product('OBSERVATION_RANGE'), decisionDelayMs: max('DECISION_DELAY'),
    handover: values('HANDOVER_FAILURE').length > 0, noGoBoundary: min('NO_GO_REGION'),
    priority: values('EMERGENCY_PRIORITY').length > 0,
    closed: values('AIRPORT_CLOSURE').length > 0,
    runwayClosed: values('RUNWAY_CLOSURE').length > 0 || max('CROSSWIND') >= 0.5,
    arrivalIntervalMs: values('ARRIVAL_CAPACITY').length ? 60_000 / min('ARRIVAL_CAPACITY') : 0,
    alternateIntervalMs: values('ALTERNATE_CAPACITY').length ? 60_000 / min('ALTERNATE_CAPACITY') : 0,
    processingBudget: min('ATC_BACKLOG'), backgroundDemand: max('DEMAND_SURGE'),
  };
}
