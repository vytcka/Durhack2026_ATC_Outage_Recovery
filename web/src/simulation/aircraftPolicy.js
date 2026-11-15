import { decideAircraftBase } from './agents.js';
import { uniqueInbox } from './transport.js';
import { aircraftPosition, approximateDistance, chooseAlternate } from './navigation.js';
import { defaultProcedure } from './procedures.js';

const AIRBORNE = ['EN_ROUTE', 'AWAITING_ARRIVAL'];
// Engine defaults when the rulebook leaves a trigger out.
const DEFAULT_RULES = Object.freeze({ COMLOST: 'CONTINUE', DESTCLOSED: 'RETURNTOORIGIN', NOGOREGION: 'DETOUR' });
// Shortest schematic approach to any alternate, and the leg length used when no coordinates exist.
const MIN_DIVERSION_MS = 60_000;
const FALLBACK_DIVERSION_MS = 120_000;
// Silence from the controlling ATC (no reply at all) before the lost-comms procedure starts.
const COMLOST_TIMEOUTS = 2;
// Decision reasoning kept per aircraft (newest last).
const MAX_REASONING = 30;
const NM_PER_DEGREE = 60;
// Requests normally relayed through a peer after a timeout.
const RELAY_TYPES = ['DEPARTURE_REQUEST', 'PLAN_ACCEPT', 'ARRIVAL_REQUEST', 'REROUTE_REQUEST'];
// While a procedure's Relay block is in force, these go through peers as well, least important
// first: only one relay envelope per peer survives the per-decision de-duplication, so the last wins.
const FORCED_RELAY_ORDER = ['DESTINATION_STATUS_REQUEST', 'DEPARTURE_REQUEST', 'PLAN_ACCEPT', 'REROUTE_REQUEST',
  'ARRIVAL_REQUEST', 'ALTERNATE_REQUEST'];
const DIVERT_ACTIONS = Object.freeze({ NEAREST: 'LANDNEARESTAIRPORT', ORIGIN: 'RETURNTOORIGIN' });
// Blocks that stop route progress while they run.
const NO_PROGRESS_COMMANDS = new Set(['HOLD', 'CIRCLE']);
const TIMED_COMMANDS = new Set(['CONTINUE', 'HOLD', 'CIRCLE']);

const ruleAction = (state, trigger) => state.rules?.[trigger] ?? DEFAULT_RULES[trigger];

// Append one decision to the aircraft's own reasoning trail (only on state changes, never per tick).
function note(state, entry) {
  state.reasoning = [...(state.reasoning ?? []), entry].slice(-MAX_REASONING);
}

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

const isKnownAirport = (state, iata) => iata === state.flight.airport_dep
  || Boolean(state.knownAirports?.some(airport => airport.iata === iata));

// Only locally known airports are considered; closures are known only once communicated.
function pickAlternate(state) {
  const preferred = state.preferredAlternate;
  if (preferred && preferred !== state.flight.airport_dest && !state.unavailableAirports?.[preferred]
    && isKnownAirport(state, preferred)) return { airport: preferred, policy: 'PREFERRED' };
  const origin = state.flight.airport_dep;
  if (state.alternateAction !== 'LANDNEARESTAIRPORT' && !state.unavailableAirports?.[origin]) {
    return { airport: origin, policy: 'RETURNTOORIGIN' };
  }
  const airport = chooseAlternate(state, 'LANDNEARESTAIRPORT');
  return airport ? { airport, policy: 'LANDNEARESTAIRPORT' } : null;
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

// Which ATC this aircraft is waiting to hear from, and since when it has been silent.
// En route: the destination ATC (periodic status checks). Awaiting arrival: the arrival ATC.
// The aircraft cannot tell a broken link from a controller that simply does not answer.
function controllerSilence(state, destinationAtc) {
  if (state.phase === 'EN_ROUTE' && !state.diverted && state.departedAt !== null) {
    return { atc: destinationAtc, since: state.lastDestinationContactAt ?? state.departedAt };
  }
  if (state.phase === 'AWAITING_ARRIVAL' && state.arrivalRequestedAt != null) {
    return { atc: `atc:${state.arrivalAirport ?? state.flight.airport_dest}`,
      since: Math.max(state.lastArrivalContactAt ?? -Infinity, state.arrivalRequestedAt) };
  }
  return null;
}

// Run blocks from the current one. Instant blocks chain within the tick; timed blocks wait.
function runSteps(state, procedureState, steps, time) {
  let current = procedureState;
  for (let guard = 0; guard <= steps.length; guard += 1) {
    const step = steps[current.stepIndex];
    if (!step) return { ...current, command: null, outcome: 'completed' };
    if (current.stepStartedAt === null) {
      current = { ...current, stepStartedAt: time, command: step.command };
      note(state, { at: time, kind: 'PROCEDURE_STEP', index: current.stepIndex, step: { ...step } });
    }
    if (TIMED_COMMANDS.has(step.command)) {
      if (time - current.stepStartedAt < step.minutes * 60_000) return current;
    } else if (step.command === 'SQUAWK') {
      state.squawk = step.code;
    } else if (step.command === 'RELAY') {
      state.relayMode = true;
    } else if (step.command === 'DIVERT') {
      if (step.target !== 'NEAREST' && step.target !== 'ORIGIN') state.preferredAlternate = step.target;
      seekAlternate(state, 'COMLOST', DIVERT_ACTIONS[step.target] ?? 'LANDNEARESTAIRPORT');
      return { ...current, stepIndex: current.stepIndex + 1, stepStartedAt: null, command: 'DIVERT', outcome: 'diverting' };
    }
    current = { ...current, stepIndex: current.stepIndex + 1, stepStartedAt: null, command: null };
  }
  return current;
}

// Local policy: environment contains only this node's current capabilities/observations.
export function decideAircraft(agent, time, timeoutMs, tickMs, environment) {
  const ready = time >= (agent.readyAt ?? 0);
  const originalFlight = agent.flight;
  const destinationAtc = `atc:${originalFlight.airport_dest}`;
  const arrivalAtc = `atc:${agent.arrivalAirport ?? originalFlight.airport_dest}`;
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
    if (message.from === arrivalAtc) before.lastArrivalContactAt = time;
    if (message.type === 'REROUTE_APPROVED' && before.phase === 'EN_ROUTE' && !before.diverted
      && before.reroute?.boundary !== message.payload.boundary
      && message.from === destinationAtc && message.payload.planId === before.plan?.id
      && message.payload.boundary === before.requestedBoundary && Number.isFinite(environment.noGoBoundary)
      && message.payload.boundary === environment.noGoBoundary) {
      before.reroute = { startProgress: before.progress, endProgress: 0.98,
        boundary: message.payload.boundary, offset: 0.18, distanceFactor: 1.5,
        reason: 'NO_GO_REGION', approvedAt: time };
      notes.push({ type: 'ROUTE_REPLANNED', agentId: agent.id, reason: 'NO_GO_REGION' });
      note(before, { at: time, kind: 'REROUTE_APPROVED', boundary: message.payload.boundary });
    }
    if (message.type === 'PLAN_UNKNOWN' && before.departedAt === null) {
      before.phase = 'REQUESTING_DEPARTURE'; before.lastSentAt = -Infinity;
    }
    if (message.type === 'HANDOVER_ACK') before.handoverPending = false;
    if (message.type === 'AIRPORT_UNAVAILABLE' && AIRBORNE.includes(before.phase) && !before.diverted
      && message.payload.planId === before.plan?.id) {
      const airport = message.from.slice('atc:'.length);
      const alreadyKnown = Boolean(before.unavailableAirports?.[airport]);
      before.unavailableAirports = { ...before.unavailableAirports, [airport]: true };
      if (message.from === destinationAtc) {
        if (!alreadyKnown) note(before, { at: time, kind: 'DESTINATION_CLOSED', airport });
        const action = ruleAction(before, 'DESTCLOSED');
        recordDecision(before, notes, 'DESTCLOSED', action, time);
        seekAlternate(before, 'DESTCLOSED', action);
      }
      // A refusing alternate is dropped at once and the next known airport is asked.
      if (airport === before.alternateCandidate) {
        note(before, { at: time, kind: 'ALTERNATE_REFUSED', airport });
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
      note(before, { at: time, kind: 'DIVERSION_STARTED', airport, previousAirport: originalFlight.airport_dest,
        legNm: Math.round(approximateDistance(fromPosition, destination) * NM_PER_DEGREE), legMs: durationMs });
    }
  }
  before.inbox = messages;

  // Lost communication: no word from the controlling ATC for 2 timeouts starts this aircraft's
  // procedure (its own, the shared default, or the one implied by the rulebook COMLOST action).
  const procedure = before.procedure ?? { steps: defaultProcedure(ruleAction(before, 'COMLOST')), source: 'rulebook' };
  const silence = controllerSilence(before, destinationAtc);
  let procedureState = before.procedureState;
  if (procedureState?.active && silence && messages.some(message => message.from === silence.atc)) {
    note(before, { at: time, kind: 'CONTACT_RESTORED', controller: silence.atc, afterMs: time - procedureState.startedAt });
    procedureState = { ...procedureState, active: false, command: null, outcome: 'contact-restored', endedAt: time };
    before.squawk = undefined;
    before.relayMode = false;
  }
  // One run per silence episode: a finished run is not restarted until contact has been heard again.
  if (ready && !procedureState?.active && silence && time - silence.since >= COMLOST_TIMEOUTS * timeoutMs
    && procedureState?.silenceSince !== silence.since) {
    const rule = ruleAction(before, 'COMLOST');
    recordDecision(before, notes, 'COMLOST', procedure.source === 'rulebook' ? rule : 'PROCEDURE', time);
    procedureState = { active: true, trigger: 'COMLOST', source: procedure.source, controller: silence.atc,
      silenceSince: silence.since, startedAt: time, stepIndex: 0, stepStartedAt: null, command: null,
      outcome: 'running', endedAt: null };
    note(before, { at: time, kind: 'CONTACT_LOST', controller: silence.atc, silenceMs: time - silence.since,
      source: procedure.source });
  }
  if (ready && procedureState?.active && procedureState.outcome === 'running') {
    procedureState = runSteps(before, procedureState, procedure.steps, time);
  }
  if (procedureState !== before.procedureState) before.procedureState = procedureState;
  const procedureFreezes = Boolean(procedureState?.active && procedureState.outcome === 'running'
    && NO_PROGRESS_COMMANDS.has(procedure.steps[procedureState.stepIndex]?.command));

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
    if (before.noGoNotedBoundary !== environment.noGoBoundary) {
      before.noGoNotedBoundary = environment.noGoBoundary;
      note(before, { at: time, kind: 'NO_GO_AHEAD', boundary: environment.noGoBoundary, action });
    }
    speed = Math.min(speed, Math.max(0, environment.noGoBoundary * nominalDuration - before.travelWorkMs) / tickMs);
    // HOLD waits at the boundary until the region clears; DETOUR negotiates a bypass.
    if (action === 'DETOUR' && ready && time - (before.lastRerouteAt ?? -Infinity) >= timeoutMs) {
      emit(destinationAtc, 'REROUTE_REQUEST', { planId: before.plan?.id, boundary: environment.noGoBoundary });
      if (before.requestedBoundary !== environment.noGoBoundary) {
        note(before, { at: time, kind: 'REROUTE_REQUESTED', boundary: environment.noGoBoundary });
      }
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
  // Hold / Circle around blocks: no route progress while they run.
  if (procedureFreezes && before.phase === 'EN_ROUTE') speed = 0;
  const result = decideAircraftBase(before, time, timeoutMs, tickMs, alternateStarted ? 0 : speed);
  const next = result.next;
  next.flight = originalFlight;
  next.climbProgress = climbProgress;
  next.reserve = Math.max(0, (agent.reserve ?? 1) - (airborne ? tickMs / (originalFlight.est_flight_dur * 120_000) * environment.burnMultiplier : 0));
  next.priority = Boolean(environment.priority || agent.priority || next.reserve < 0.2);
  next.reserveStressed = Boolean(agent.reserveStressed || environment.burnMultiplier > 1);

  // Reasoning for transitions the base protocol made this tick.
  if (agent.phase === 'WAITING' && next.phase === 'REQUESTING_DEPARTURE') {
    note(next, { at: time, kind: 'DEPARTURE_REQUESTED', airport: originalFlight.airport_dep });
  }
  if (agent.departedAt == null && next.departedAt != null) {
    note(next, { at: time, kind: 'DEPARTED', airport: originalFlight.airport_dep });
  }
  if (agent.phase !== 'AWAITING_ARRIVAL' && next.phase === 'AWAITING_ARRIVAL') {
    note(next, { at: time, kind: 'ARRIVAL_REQUESTED', airport: next.arrivalAirport ?? originalFlight.airport_dest });
  }
  if (agent.phase !== 'ARRIVED' && next.phase === 'ARRIVED') {
    note(next, { at: time, kind: 'ARRIVAL_APPROVED', airport: next.arrivalAirport ?? originalFlight.airport_dest,
      waitedMs: next.arrivalRequestedAt == null ? 0 : time - next.arrivalRequestedAt });
  }
  if ((agent.reserve ?? 1) >= 0.2 && next.reserve < 0.2) {
    note(next, { at: time, kind: 'LOW_RESERVE', reserve: next.reserve });
  }
  // A diversion (approved by the alternate) or a landing ends the lost-comms episode.
  if (next.procedureState?.active && (next.phase === 'ARRIVED' || (next.diverted && !agent.diverted))) {
    next.procedureState = { ...next.procedureState, active: false, command: null, endedAt: time,
      outcome: next.diverted ? 'diverting' : next.procedureState.outcome === 'running' ? 'completed' : next.procedureState.outcome };
    next.squawk = undefined;
    next.relayMode = false;
  }

  if (next.reserveStressed && next.phase === 'AWAITING_ARRIVAL' && next.reserve < 0.2 && !next.needAlternate
    && time - next.arrivalRequestedAt >= timeoutMs) {
    const action = ruleAction(next, 'DESTCLOSED');
    recordDecision(next, notes, 'LOWRESERVE', action, time);
    seekAlternate(next, 'LOWRESERVE', action);
  }
  if (next.priority && !agent.priority && ready && !['WAITING', 'ARRIVED'].includes(next.phase)) {
    const airport = next.arrivalAirport ?? originalFlight.airport_dest;
    emit(`atc:${airport}`, 'PRIORITY_REQUEST', { planId: next.plan?.id });
    note(next, { at: time, kind: 'PRIORITY_REQUESTED', airport });
  }
  if (ready && AIRBORNE.includes(next.phase) && next.needAlternate && !next.diverted
    && time - (next.lastAlternateAt ?? -Infinity) >= timeoutMs) {
    // Keep asking the same airport until it approves or refuses, so replies stay unambiguous.
    if (!next.alternateCandidate) {
      const choice = pickAlternate(next);
      if (choice) {
        next.alternateCandidate = choice.airport;
        note(next, { at: time, kind: 'ALTERNATE_CHOSEN', airport: choice.airport, policy: choice.policy,
          trigger: next.alternateTrigger ?? null,
          distanceNm: Math.round(approximateDistance(aircraftPosition(next), airportPosition(next, choice.airport)) * NM_PER_DEGREE),
          excluded: [...new Set([originalFlight.airport_dest, ...Object.keys(next.unavailableAirports ?? {})])] });
      }
    }
    if (next.alternateCandidate) {
      emit(`atc:${next.alternateCandidate}`, 'ALTERNATE_REQUEST', { planId: next.plan.id, priority: next.priority });
      next.lastAlternateAt = time;
    }
  }
  // Keep talking to the controller: the destination ATC en route, the arrival ATC while waiting to
  // land. A controller that is only holding the plane (runway closed, arrival queue) still answers
  // status checks, which need no runway, so a long landing queue is not mistaken for lost comms.
  const statusAtc = next.phase === 'EN_ROUTE' && !next.diverted ? destinationAtc
    : next.phase === 'AWAITING_ARRIVAL' ? `atc:${next.arrivalAirport ?? originalFlight.airport_dest}` : null;
  if (ready && statusAtc && time - (agent.lastDestinationCheckAt ?? -Infinity) >= timeoutMs) {
    emit(statusAtc, 'DESTINATION_STATUS_REQUEST', { planId: next.plan.id });
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
  const forcedRelay = Boolean(next.relayMode && next.procedureState?.active);
  if (peer && forcedRelay) {
    // Relay block: route ATC requests via the peer without waiting for another timeout.
    const relayed = outgoing.filter(item => item.to.startsWith('atc:') && FORCED_RELAY_ORDER.includes(item.type))
      .sort((a, b) => FORCED_RELAY_ORDER.indexOf(a.type) - FORCED_RELAY_ORDER.indexOf(b.type));
    for (const message of relayed) outgoing.push({ from: agent.id, to: peer, type: 'RELAY_REQUEST', payload: { message } });
  } else if (peer && next.timeouts > agent.timeouts) {
    for (const message of outgoing.filter(item => item.to.startsWith('atc:') && RELAY_TYPES.includes(item.type))) {
      outgoing.push({ from: agent.id, to: peer, type: 'RELAY_REQUEST', payload: { message } });
    }
  }
  // A transport duplicate or retry must never amplify indefinitely within one decision.
  outgoing = [...new Map(outgoing.map(message => [`${message.to}:${message.type}`, message])).values()];
  return { next, outgoing, events: [...filtered.events, ...result.events, ...notes] };
}
