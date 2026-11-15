import { decideAircraftBase } from './agents.js';
import { uniqueInbox } from './transport.js';
import { aircraftPosition, approximateDistance, chooseAlternate } from './navigation.js';

const AIRBORNE = ['EN_ROUTE', 'AWAITING_ARRIVAL'];
// Engine defaults when the rulebook leaves a trigger out.
const DEFAULT_RULES = Object.freeze({ COMLOST: 'CONTINUE', DESTCLOSED: 'RETURNTOORIGIN', NOGOREGION: 'DETOUR' });
// Shortest schematic approach to any alternate, and the leg length used when no coordinates exist.
const MIN_DIVERSION_MS = 60_000;
const FALLBACK_DIVERSION_MS = 120_000;
// Silence from the destination ATC (no reply to periodic status checks) before COMLOST fires.
const COMLOST_TIMEOUTS = 2;

const ruleAction = (state, trigger) => state.rules?.[trigger] ?? DEFAULT_RULES[trigger];

// Each trigger is recorded once per flight so overlapping conditions cannot spam the event log.
function recordDecision(state, notes, trigger, action, time) {
  if (state.triggeredRules?.[trigger]) return;
  state.triggeredRules = { ...state.triggeredRules, [trigger]: action };
  state.protocolDecision = { trigger, action, at: time };
  notes.push({ type: 'RULE_TRIGGERED', agentId: state.id, trigger, action });
}

// The first reason to seek an alternate decides which airport policy is used.
function seekAlternate(state, trigger, action) {
  if (state.needAlternate || state.diverted) return;
  state.needAlternate = true;
  state.alternateTrigger = trigger;
  state.alternateAction = action;
}

// Only locally known airports are considered; closures are known only once communicated.
function pickAlternate(state) {
  const origin = state.flight.airport_dep;
  if (state.alternateAction !== 'LANDNEARESTAIRPORT' && !state.unavailableAirports?.[origin]) return origin;
  return chooseAlternate(state, 'LANDNEARESTAIRPORT');
}

function airportPosition(state, iata) {
  const known = state.knownAirports?.find(airport => airport.iata === iata);
  if (known) return [known.lon, known.lat];
  return state.flight.origin ?? [0, 0];
}

// The new leg is flown at the flight's own average ground speed (route length / scheduled duration).
function diversionDurationMs(flight, from, to, tickMs) {
  const route = flight.origin && flight.destination ? approximateDistance(flight.origin, flight.destination) : 0;
  if (!(route > 0)) return FALLBACK_DIVERSION_MS;
  const legMs = approximateDistance(from, to) / route * flight.est_flight_dur * 60_000;
  return Math.max(MIN_DIVERSION_MS, Math.ceil(legMs / tickMs) * tickMs);
}

// Local policy: environment contains only this node's current capabilities/observations.
export function decideAircraft(agent, time, timeoutMs, tickMs, environment) {
  const ready = time >= (agent.readyAt ?? 0);
  const originalFlight = agent.flight;
  const destinationAtc = `atc:${originalFlight.airport_dest}`;
  const localTime = time + environment.clockOffsetMs;
  const before = { ...agent, knownPeers: { ...agent.knownPeers }, inbox: ready ? agent.inbox : [],
    lastSentAt: agent.lastSentAt - environment.clockOffsetMs };
  const auxiliary = [];
  const notes = [];
  const emit = (to, type, payload) => auxiliary.push({ from: agent.id, to, type, payload });
  const filtered = uniqueInbox(before);
  const messages = [];
  let alternateStarted = false;
  for (const message of filtered.messages) {
    if (message.type === 'PEER_STATUS') before.knownPeers[message.from] = { ...message.payload, receivedAt: time };
    else if (message.type === 'RELAY_REQUEST') {
      const inner = message.payload.message;
      if (inner?.from === message.from && inner.to?.startsWith('atc:')) emit(inner.to, 'RELAY_UP', { message: inner });
    } else if (message.type === 'RELAY_DOWN') {
      const inner = message.payload.message;
      if (inner?.from === message.from && inner.to?.startsWith('aircraft:')) emit(inner.to, 'RELAY_DELIVERY', { message: inner });
    } else if (message.type === 'RELAY_DELIVERY') {
      const inner = message.payload.message;
      if (inner?.to === agent.id && inner.from?.startsWith('atc:')) messages.push({ ...message, ...inner });
    } else messages.push(message);
  }
  for (const message of messages) {
    if (message.from === destinationAtc) before.lastDestinationContactAt = time;
    if (message.type === 'REROUTE_APPROVED' && before.phase === 'EN_ROUTE' && !before.diverted
      && before.reroute?.boundary !== message.payload.boundary
      && message.from === destinationAtc && message.payload.planId === before.plan?.id
      && message.payload.boundary === before.requestedBoundary && Number.isFinite(environment.noGoBoundary)
      && message.payload.boundary === environment.noGoBoundary) {
      before.reroute = { startProgress: before.progress, endProgress: 0.98,
        boundary: message.payload.boundary, offset: 0.18, distanceFactor: 1.5,
        reason: 'NO_GO_REGION', approvedAt: time };
      notes.push({ type: 'ROUTE_REPLANNED', agentId: agent.id, reason: 'NO_GO_REGION' });
    }
    if (message.type === 'PLAN_UNKNOWN' && before.departedAt === null) {
      before.phase = 'REQUESTING_DEPARTURE'; before.lastSentAt = -Infinity;
    }
    if (message.type === 'HANDOVER_ACK') before.handoverPending = false;
    if (message.type === 'AIRPORT_UNAVAILABLE' && AIRBORNE.includes(before.phase) && !before.diverted
      && message.payload.planId === before.plan?.id) {
      const airport = message.from.slice('atc:'.length);
      before.unavailableAirports = { ...before.unavailableAirports, [airport]: true };
      if (message.from === destinationAtc) {
        const action = ruleAction(before, 'DESTCLOSED');
        recordDecision(before, notes, 'DESTCLOSED', action, time);
        seekAlternate(before, 'DESTCLOSED', action);
      }
      // A refusing alternate is dropped at once and the next known airport is asked.
      if (airport === before.alternateCandidate) {
        before.alternateCandidate = null;
        before.lastAlternateAt = -Infinity;
      }
    }
    if (message.type === 'ALTERNATE_APPROVED' && AIRBORNE.includes(before.phase)
      && before.needAlternate && message.payload.planId === before.plan?.id && !before.diverted
      && before.alternateCandidate && message.from === `atc:${before.alternateCandidate}`) {
      const airport = before.alternateCandidate;
      // Turn at the current position and fly straight to the alternate.
      const fromPosition = aircraftPosition(before);
      const destination = airportPosition(before, airport);
      const durationMs = diversionDurationMs(originalFlight, fromPosition, destination, tickMs);
      before.diversion = { mode: 'direct', airport, previousAirport: originalFlight.airport_dest,
        trigger: before.alternateTrigger ?? null, action: before.alternateAction ?? null, startedAt: time,
        startProgress: before.progress, startWorkMs: before.travelWorkMs, durationMs,
        fromPosition, destination, reroute: before.reroute ?? null };
      before.diverted = true;
      before.arrivalAirport = airport;
      before.plan = { ...before.plan, durationMs: before.travelWorkMs + durationMs };
      before.phase = 'EN_ROUTE'; before.arrivalRequestedAt = null;
      alternateStarted = true;
      notes.push({ type: 'DIVERSION_STARTED', agentId: agent.id, airport });
    }
  }
  before.inbox = messages;
  if (ready && before.phase === 'EN_ROUTE' && !before.diverted && before.departedAt !== null
    && time - (before.lastDestinationContactAt ?? before.departedAt) >= COMLOST_TIMEOUTS * timeoutMs) {
    const action = ruleAction(before, 'COMLOST');
    recordDecision(before, notes, 'COMLOST', action, time);
    if (action !== 'CONTINUE') seekAlternate(before, 'COMLOST', action);
  }
  if (before.diverted) before.flight = { ...originalFlight, airport_dest: before.arrivalAirport };
  if (!ready) before.lastSentAt = time;

  const airborne = agent.phase === 'EN_ROUTE' || agent.phase === 'AWAITING_ARRIVAL';
  const climbProgress = Math.min(1, (agent.climbProgress ?? 0) + (airborne ? tickMs / 60_000 * environment.climbFactor : 0));
  const expectedClimb = agent.departedAt === null ? 0 : Math.min(1, (time - agent.departedAt) / 60_000);
  let speed = environment.speedFactor * (expectedClimb > 0 ? Math.min(1, climbProgress / expectedClimb) : 1);
  const nominalDuration = before.plan?.durationMs ?? originalFlight.est_flight_dur * 60_000;
  const bypass = before.reroute?.boundary === environment.noGoBoundary;
  if (before.reroute && !before.diverted && before.progress < before.reroute.endProgress) speed /= before.reroute.distanceFactor;
  if (Number.isFinite(environment.noGoBoundary) && before.phase === 'EN_ROUTE' && !before.diverted && !bypass) {
    const action = ruleAction(before, 'NOGOREGION');
    recordDecision(before, notes, 'NOGOREGION', action, time);
    speed = Math.min(speed, Math.max(0, environment.noGoBoundary * nominalDuration - before.travelWorkMs) / tickMs);
    // HOLD waits at the boundary until the region clears; DETOUR negotiates a bypass.
    if (action === 'DETOUR' && ready && time - (before.lastRerouteAt ?? -Infinity) >= timeoutMs) {
      emit(destinationAtc, 'REROUTE_REQUEST', { planId: before.plan?.id, boundary: environment.noGoBoundary });
      before.requestedBoundary = environment.noGoBoundary;
      before.lastRerouteAt = time;
    }
  }
  if (environment.handover && before.progress >= 0.5 && !before.handoverCompleted) before.handoverPending = true;
  if (before.handoverPending) {
    speed = Math.min(speed, Math.max(0, nominalDuration * 0.9 - before.travelWorkMs) / tickMs);
    if (ready && time - (before.lastHandoverAt ?? -Infinity) >= timeoutMs) {
      emit(destinationAtc, 'HANDOVER_REQUEST', { planId: before.plan?.id });
      before.lastHandoverAt = time;
    }
  }
  if (messages.some(message => message.type === 'HANDOVER_ACK')) before.handoverCompleted = true;
  const result = decideAircraftBase(before, time, timeoutMs, tickMs, alternateStarted ? 0 : speed);
  const next = result.next;
  next.flight = originalFlight;
  next.climbProgress = climbProgress;
  next.reserve = Math.max(0, (agent.reserve ?? 1) - (airborne ? tickMs / (originalFlight.est_flight_dur * 120_000) * environment.burnMultiplier : 0));
  next.priority = Boolean(environment.priority || agent.priority || next.reserve < 0.2);
  next.reserveStressed = Boolean(agent.reserveStressed || environment.burnMultiplier > 1);
  if (next.reserveStressed && next.phase === 'AWAITING_ARRIVAL' && next.reserve < 0.2 && !next.needAlternate
    && time - next.arrivalRequestedAt >= timeoutMs) {
    const action = ruleAction(next, 'DESTCLOSED');
    recordDecision(next, notes, 'LOWRESERVE', action, time);
    seekAlternate(next, 'LOWRESERVE', action);
  }
  if (next.priority && !agent.priority && ready && !['WAITING', 'ARRIVED'].includes(next.phase)) {
    emit(`atc:${next.arrivalAirport ?? originalFlight.airport_dest}`, 'PRIORITY_REQUEST', { planId: next.plan?.id });
  }
  if (ready && AIRBORNE.includes(next.phase) && next.needAlternate && !next.diverted
    && time - (next.lastAlternateAt ?? -Infinity) >= timeoutMs) {
    // Keep asking the same airport until it approves or refuses, so replies stay unambiguous.
    next.alternateCandidate ??= pickAlternate(next);
    if (next.alternateCandidate) {
      emit(`atc:${next.alternateCandidate}`, 'ALTERNATE_REQUEST', { planId: next.plan.id, priority: next.priority });
      next.lastAlternateAt = time;
    }
  }
  if (ready && next.phase === 'EN_ROUTE' && !next.diverted
    && time - (agent.lastDestinationCheckAt ?? -Infinity) >= timeoutMs) {
    emit(destinationAtc, 'DESTINATION_STATUS_REQUEST', { planId: next.plan.id });
    next.lastDestinationCheckAt = time;
  }
  if (ready && next.phase !== 'ARRIVED' && time - (agent.lastPeerReportAt ?? -Infinity) >= 60_000) {
    for (const peer of environment.visiblePeers ?? []) emit(peer, 'PEER_STATUS', { progress: next.progress, observedAt: localTime });
    next.lastPeerReportAt = time;
  }

  const held = agent.pendingMessages ?? [];
  let outgoing = ready ? [...held, ...result.outgoing, ...auxiliary] : [];
  next.pendingMessages = ready ? [] : [...held, ...result.outgoing];
  if (!ready) {
    next.inbox = agent.inbox;
    next.lastSentAt = agent.lastSentAt;
  } else {
    next.lastSentAt += environment.clockOffsetMs;
    next.readyAt = time + environment.decisionDelayMs;
  }
  // Reports reflect private observations; true positions are not overwritten by sensor faults.
  outgoing = outgoing.map(message => ({ ...message, payload: { ...message.payload,
    report: { progress: next.progress + environment.positionBias, observedAt: localTime - environment.reportAgeMs },
    priority: next.priority, diverted: next.diverted ?? false,
  } }));
  const peer = Object.keys(next.knownPeers).find(id => (environment.visiblePeers ?? []).includes(id)
    && time - next.knownPeers[id].receivedAt <= 2 * timeoutMs);
  if (peer && next.timeouts > agent.timeouts) {
    for (const message of outgoing.filter(item => item.to.startsWith('atc:') && ['DEPARTURE_REQUEST', 'PLAN_ACCEPT', 'ARRIVAL_REQUEST', 'REROUTE_REQUEST'].includes(item.type))) {
      outgoing.push({ from: agent.id, to: peer, type: 'RELAY_REQUEST', payload: { message } });
    }
  }
  // A transport duplicate or retry must never amplify indefinitely within one decision.
  outgoing = [...new Map(outgoing.map(message => [`${message.to}:${message.type}`, message])).values()];
  return { next, outgoing, events: [...filtered.events, ...result.events, ...notes] };
}
