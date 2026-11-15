// One place that decides how a flight reads on the map, in the tracker and on its card.
// Hue encodes punctuality / route state; landed planes keep their hue and are dimmed by CSS,
// so a late or diverted landing never looks like an on-time one.

const AIRBORNE = new Set(['EN_ROUTE', 'AWAITING_ARRIVAL']);

// Display order for legends and tracker summaries.
export const FLIGHT_STATUSES = [
  { id: 'scheduled', label: 'Awaiting departure', short: 'Scheduled', color: 'var(--status-scheduled)', disrupted: false, landed: false },
  { id: 'on-time', label: 'En route · on time', short: 'On time', color: 'var(--status-on-time)', disrupted: false, landed: false },
  { id: 'delayed', label: 'Delayed', short: 'Delayed', color: 'var(--status-delayed)', disrupted: true, landed: false },
  { id: 'detouring', label: 'Detouring', short: 'Detour', color: 'var(--status-detouring)', disrupted: true, landed: false },
  { id: 'diverting', label: 'Diverting to new airport', short: 'Diverting', color: 'var(--status-diverting)', disrupted: true, landed: false },
  { id: 'landed', label: 'Landed · on time', short: 'Landed', color: 'var(--status-landed)', disrupted: false, landed: true },
  { id: 'landed-late', label: 'Landed · late', short: 'Landed late', color: 'var(--status-delayed)', disrupted: true, landed: true },
  { id: 'detoured-landed', label: 'Landed after detour', short: 'Detoured', color: 'var(--status-detouring)', disrupted: true, landed: true },
  { id: 'diverted-landed', label: 'Landed at alternate', short: 'Diverted', color: 'var(--status-diverting)', disrupted: true, landed: true },
];

export const FLIGHT_STATUS_BY_ID = Object.fromEntries(FLIGHT_STATUSES.map(status => [status.id, status]));

// `agent` is one entry of snapshot.aircraft (or undefined before the first snapshot).
export function flightStatus(agent) {
  if (!agent) return 'scheduled';
  const landed = agent.phase === 'ARRIVED';
  if (agent.diverted) return landed ? 'diverted-landed' : 'diverting';
  // A detour stays on the record after landing, so it is still counted once the plane is down.
  if (landed) return agent.reroute ? 'detoured-landed' : agent.delayed ? 'landed-late' : 'landed';
  if (agent.reroute) return 'detouring';
  if (agent.delayed) return 'delayed'; // includes ground delay before departure
  return AIRBORNE.has(agent.phase) ? 'on-time' : 'scheduled';
}

export function isAirborne(agent) {
  return AIRBORNE.has(agent?.phase);
}

export function isDisrupted(agent) {
  return FLIGHT_STATUS_BY_ID[flightStatus(agent)].disrupted;
}
