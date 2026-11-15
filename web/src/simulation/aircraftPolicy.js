import { decideAircraftBase } from './agents.js';
import { uniqueInbox } from './transport.js';

// Local policy: environment contains only this node's current capabilities/observations.
export function decideAircraft(agent, time, timeoutMs, tickMs, environment) {
  const ready = time >= (agent.readyAt ?? 0);
  const originalFlight = agent.flight;
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
    if (message.type === 'PLAN_UNKNOWN' && before.departedAt === null) {
      before.phase = 'REQUESTING_DEPARTURE'; before.lastSentAt = -Infinity;
    }
    if (message.type === 'HANDOVER_ACK') before.handoverPending = false;
    if (message.type === 'AIRPORT_UNAVAILABLE' && before.phase === 'AWAITING_ARRIVAL') before.needAlternate = true;
    if (message.type === 'ALTERNATE_APPROVED' && before.phase === 'AWAITING_ARRIVAL'
      && message.from === `atc:${originalFlight.airport_dep}` && !before.diverted) {
      before.diverted = true;
      before.arrivalAirport = originalFlight.airport_dep;
      before.plan = { ...before.plan, durationMs: originalFlight.est_flight_dur * 60_000 + 120_000 };
      before.phase = 'EN_ROUTE'; before.arrivalRequestedAt = null;
      alternateStarted = true;
      notes.push({ type: 'DIVERSION_STARTED', agentId: agent.id });
    }
  }
  before.inbox = messages;
  if (before.diverted) before.flight = { ...originalFlight, airport_dest: before.arrivalAirport };
  if (!ready) before.lastSentAt = time;

  const airborne = agent.phase === 'EN_ROUTE' || agent.phase === 'AWAITING_ARRIVAL';
  const climbProgress = Math.min(1, (agent.climbProgress ?? 0) + (airborne ? tickMs / 60_000 * environment.climbFactor : 0));
  const expectedClimb = agent.departedAt === null ? 0 : Math.min(1, (time - agent.departedAt) / 60_000);
  let speed = environment.speedFactor * (expectedClimb > 0 ? Math.min(1, climbProgress / expectedClimb) : 1);
  const nominalDuration = before.plan?.durationMs ?? originalFlight.est_flight_dur * 60_000;
  if (Number.isFinite(environment.noGoBoundary) && before.phase === 'EN_ROUTE') {
    speed = Math.min(speed, Math.max(0, environment.noGoBoundary * nominalDuration - before.travelWorkMs) / tickMs);
  }
  if (environment.handover && before.progress >= 0.5 && !before.handoverCompleted) before.handoverPending = true;
  if (before.handoverPending) {
    speed = Math.min(speed, Math.max(0, nominalDuration * 0.9 - before.travelWorkMs) / tickMs);
    if (ready && time - (before.lastHandoverAt ?? -Infinity) >= timeoutMs) {
      emit(`atc:${originalFlight.airport_dest}`, 'HANDOVER_REQUEST', { planId: before.plan?.id });
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
  if (next.priority && !agent.priority && ready && !['WAITING', 'ARRIVED'].includes(next.phase)) {
    emit(`atc:${next.arrivalAirport ?? originalFlight.airport_dest}`, 'PRIORITY_REQUEST', { planId: next.plan?.id });
  }
  if (ready && next.needAlternate && !next.diverted && time - (agent.lastAlternateAt ?? -Infinity) >= timeoutMs) {
    emit(`atc:${originalFlight.airport_dep}`, 'ALTERNATE_REQUEST', { planId: next.plan.id, priority: next.priority });
    next.lastAlternateAt = time;
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
    for (const message of outgoing.filter(item => item.to.startsWith('atc:') && ['DEPARTURE_REQUEST', 'PLAN_ACCEPT', 'ARRIVAL_REQUEST'].includes(item.type))) {
      outgoing.push({ from: agent.id, to: peer, type: 'RELAY_REQUEST', payload: { message } });
    }
  }
  // A transport duplicate or retry must never amplify indefinitely within one decision.
  outgoing = [...new Map(outgoing.map(message => [`${message.to}:${message.type}`, message])).values()];
  return { next, outgoing, events: [...filtered.events, ...result.events, ...notes] };
}
