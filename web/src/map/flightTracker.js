// Pure helpers behind the flight tracker panel: describe, summarise, filter and sort flights.
// No React and no geography, so everything here runs under `node --test`.
import { FLIGHT_STATUSES, FLIGHT_STATUS_BY_ID, flightStatus } from './flightStatus.js';
import { formatDelay, formatSimulationTime } from '../simulation/timing.js';

// Header chips, in display order. "Scheduled" is left out: it is only seen in the first minute.
export const SUMMARY_STATUS_IDS = ['on-time', 'delayed', 'detouring', 'diverting', 'landed', 'landed-late', 'diverted-landed'];

export const TRACKER_FILTERS = [
  { id: 'disrupted', label: 'Disrupted', empty: 'No disrupted flights yet. Schedule a disruption from Scenario controls, or select a plane to block its route or close its destination.' },
  { id: 'all', label: 'All', empty: 'No flights in the simulation yet.' },
  { id: 'delayed', label: 'Delayed', empty: 'No delayed flights.' },
  { id: 'diverted', label: 'Diverted', empty: 'No flights have changed destination airport.' },
  { id: 'detours', label: 'Detours', empty: 'No detours have been approved.' },
];

const FILTER_TESTS = {
  disrupted: row => row.disrupted,
  all: () => true,
  delayed: row => row.delayed,
  diverted: row => row.diverted,
  detours: row => row.rerouted,
};

// Lower rank sorts first; anything unlisted (on time, scheduled, landed) ranks last.
const SORT_RANK = { diverting: 0, detouring: 1, delayed: 2, 'landed-late': 3, 'diverted-landed': 3 };
const SORT_BY_DELAY = new Set([2, 3]);
const LAST_RANK = 4;

const TRIGGER_TEXT = {
  DESTCLOSED: 'Destination closed',
  COMLOST: 'Lost contact with destination ATC',
  LOWRESERVE: 'Low reserve',
};
const TRIGGER_SHORT = { DESTCLOSED: 'Destination closed', COMLOST: 'Lost contact', LOWRESERVE: 'Low reserve' };
const ACTION_TEXT = { LANDNEARESTAIRPORT: 'nearest open airport', RETURNTOORIGIN: 'return to origin' };
const DETOUR_TEXT = { NO_GO_REGION: 'no-go region' };
const DELAY_CAUSES = [
  ['departureDelayMs', 'late departure'],
  ['travelDelayMs', 'slow en route'],
  ['arrivalDelayMs', 'landing hold'],
];

// 45 s -> "+45s", 12 min -> "+12m", 75 min -> "+1h 15m". Null when there is no delay.
export function compactDelay(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const seconds = Math.max(1, Math.floor(ms / 1000));
  if (seconds < 60) return `+${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `+${minutes}m`;
  return `+${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

export function progressText(agent) {
  if (!agent) return 'Awaiting departure';
  const percent = `${Math.round(Math.min(1, Math.max(0, agent.progress ?? 0)) * 100)}%`;
  switch (agent.phase) {
    case 'ARRIVED':
      return agent.arrivedAt == null ? 'Landed' : `Landed ${formatSimulationTime(agent.arrivedAt).slice(0, 5)}`;
    case 'AWAITING_ARRIVAL':
      return 'Awaiting landing approval';
    case 'EN_ROUTE':
      return agent.diverted ? `Diversion leg ${percent}` : `En route ${percent}`;
    default:
      return 'Awaiting departure';
  }
}

// "Destination closed: DEN → IND (nearest open airport)"
export function diversionTitle(diversion, previousDestination, destination) {
  const trigger = TRIGGER_TEXT[diversion?.trigger] ?? 'Diverted';
  const action = ACTION_TEXT[diversion?.action];
  return `${trigger}: ${previousDestination} → ${destination}${action ? ` (${action})` : ''}`;
}

function dominantDelayCause(agent) {
  let best = null;
  for (const [key, label] of DELAY_CAUSES) {
    const value = agent?.[key] ?? 0;
    if (value > 0 && (!best || value > best.value)) best = { value, label };
  }
  return best?.label ?? null;
}

function detailText(status, agent) {
  if (agent?.diverted) return TRIGGER_SHORT[agent.diversion?.trigger] ?? 'Diverted';
  if (agent?.reroute) return `Detour · ${DETOUR_TEXT[agent.reroute.reason] ?? 'route change'}`;
  const cause = dominantDelayCause(agent);
  if (status === 'delayed') return cause ? `Delayed · ${cause}` : 'Delayed';
  if (status === 'landed-late') return cause ? `Late · ${cause}` : 'Late';
  return null;
}

function delayTitle(agent) {
  if (!(agent?.totalDelayMs > 0)) return null;
  return `Total delay ${formatDelay(agent.totalDelayMs)} · departure ${formatDelay(agent.departureDelayMs ?? 0)}`
    + ` · en route ${formatDelay(agent.travelDelayMs ?? 0)} · landing wait ${formatDelay(agent.arrivalDelayMs ?? 0)}`;
}

// One display row. Every field is a primitive so rows can be compared cheaply.
export function describeFlight(flight, agent) {
  const status = flightStatus(agent);
  const definition = FLIGHT_STATUS_BY_ID[status];
  const diverted = Boolean(agent?.diverted);
  const origin = flight.airport_dep;
  const previousDestination = diverted ? (agent.diversion?.previousAirport ?? flight.airport_dest) : null;
  const destination = diverted
    ? (agent.diversion?.airport ?? agent.arrivalAirport ?? flight.airport_dest)
    : (agent?.arrivalAirport ?? flight.airport_dest);
  const delayMs = Math.max(0, agent?.totalDelayMs ?? 0);
  const delay = compactDelay(delayMs);
  const progress = progressText(agent);
  const detail = detailText(status, agent);
  const title = diverted ? diversionTitle(agent.diversion, previousDestination, destination) : null;
  const route = previousDestination
    ? `${origin} to ${destination}, diverted from ${previousDestination}`
    : `${origin} to ${destination}`;
  const ariaLabel = [flight.flight_number, route, definition.label, delay && `${formatDelay(delayMs)} late`,
    progress, detail, title].filter(Boolean).join(', ');
  const row = {
    id: flight.agentId,
    flightNumber: flight.flight_number,
    status,
    statusLabel: definition.label,
    color: definition.color,
    landed: definition.landed,
    disrupted: definition.disrupted,
    delayed: Boolean(agent?.delayed),
    diverted,
    rerouted: Boolean(agent?.reroute),
    origin,
    destination,
    previousDestination,
    diversionTitle: title,
    detail,
    progress,
    delay,
    delayTitle: delayTitle(agent),
    delayMs,
    ariaLabel,
  };
  row.signature = [status, destination, previousDestination, title, detail, progress, delay, row.delayTitle].join('|');
  return row;
}

export function describeFlights(flights, agentsById) {
  return flights.map(flight => describeFlight(flight, agentsById?.[flight.agentId]));
}

export function summariseStatuses(rows) {
  const counts = Object.fromEntries(FLIGHT_STATUSES.map(status => [status.id, 0]));
  for (const row of rows) counts[row.status] += 1;
  return counts;
}

export function filterCounts(rows) {
  return Object.fromEntries(TRACKER_FILTERS.map(filter => [filter.id, rows.filter(FILTER_TESTS[filter.id]).length]));
}

export function filterRows(rows, filterId) {
  return rows.filter(FILTER_TESTS[filterId] ?? FILTER_TESTS.all);
}

// Diverting, detouring, delayed (worst first), late/diverted landings, then everything else.
export function sortRows(rows) {
  return [...rows].sort((a, b) => {
    const rankA = SORT_RANK[a.status] ?? LAST_RANK;
    const rankB = SORT_RANK[b.status] ?? LAST_RANK;
    if (rankA !== rankB) return rankA - rankB;
    if (SORT_BY_DELAY.has(rankA) && a.delayMs !== b.delayMs) return b.delayMs - a.delayMs;
    return String(a.flightNumber).localeCompare(String(b.flightNumber)) || String(a.id).localeCompare(String(b.id));
  });
}
