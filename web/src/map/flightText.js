import { flightStatus } from './flightStatus.js';

export const DIVERSION_POLICIES = [
  { id: 'LANDNEARESTAIRPORT', label: 'Nearest open airport' },
  { id: 'RETURNTOORIGIN', label: 'Return to origin' },
];

const TRIGGER_REASONS = {
  DESTCLOSED: 'destination closed',
  COMLOST: 'lost contact with destination ATC',
  LOWRESERVE: 'low reserve',
};

const ACTION_LABELS = {
  LANDNEARESTAIRPORT: 'nearest open airport',
  RETURNTOORIGIN: 'return to origin',
};

export function diversionReason(diversion) {
  return TRIGGER_REASONS[diversion?.trigger] ?? 'alternate requested';
}

export function diversionActionLabel(action) {
  return ACTION_LABELS[action] ?? null;
}

export function policyLabel(policy) {
  return DIVERSION_POLICIES.find(item => item.id === policy)?.label ?? 'Return to origin';
}

// "+12m" for delays of at least a minute, otherwise null.
export function shortDelay(ms) {
  const minutes = Math.floor((ms ?? 0) / 60_000);
  return minutes >= 1 ? `+${minutes}m` : null;
}

// Map label: flight number, plus the new airport while diverting and the delay when late.
export function aircraftLabel(flight, agent) {
  const status = flightStatus(agent);
  const parts = [flight.flight_number];
  if (status === 'diverting' || status === 'diverted-landed') parts.push(`→ ${agent.arrivalAirport}`);
  if (['delayed', 'detouring', 'diverting', 'landed-late', 'diverted-landed'].includes(status)) {
    const delay = shortDelay(agent?.totalDelayMs);
    if (delay) parts.push(delay);
  }
  return parts.join(' ');
}
