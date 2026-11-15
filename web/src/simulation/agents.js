// Toy coordination policies, not operational flight-control procedures.
// Policies receive only their own memory, their inbox and simulation time.
import { uniqueInbox } from './transport.js';
export function createAircraft(flight, index) {
  return {
    id: `aircraft:${index}`, kind: 'aircraft', flight: { ...flight }, inbox: [],
    phase: 'WAITING', plan: null, departedAt: null, arrivedAt: null, arrivalRequestedAt: null, progress: 0,
    lastSentAt: -Infinity, timeouts: 0,
    travelWorkMs: 0,
  };
}

export function createAtc(airport) {
  return { id: `atc:${airport}`, kind: 'atc', airport, inbox: [], plans: {} };
}

export function decideAircraftBase(agent, time, timeoutMs, tickMs, speedFactor) {
  const next = { ...agent, inbox: [] };
  const outgoing = [];
  const { messages, events } = uniqueInbox(agent);
  const departureAtc = `atc:${agent.flight.airport_dep}`;
  const arrivalAtc = `atc:${agent.flight.airport_dest}`;
  const send = (to, type, payload) => {
    outgoing.push({ from: agent.id, to, type, payload });
    next.lastSentAt = time;
  };

  for (const message of messages) {
    if (message.from === departureAtc && message.type === 'PLAN_OFFER'
      && ['REQUESTING_DEPARTURE', 'AWAITING_CONFIRMATION'].includes(next.phase)) {
      next.plan = message.payload.plan;
      next.phase = 'AWAITING_CONFIRMATION';
      send(departureAtc, 'PLAN_ACCEPT', { planId: next.plan.id });
    }
    if (message.from === departureAtc && message.type === 'PLAN_CONFIRMED'
      && next.phase === 'AWAITING_CONFIRMATION' && message.payload.planId === next.plan?.id) {
      next.phase = 'EN_ROUTE';
      next.departedAt = time;
      events.push({ type: 'DEPARTURE_CONFIRMED', agentId: agent.id });
    }
    if (message.from === arrivalAtc && message.type === 'ARRIVAL_APPROVED'
      && next.phase === 'AWAITING_ARRIVAL' && message.payload.planId === next.plan?.id) {
      next.phase = 'ARRIVED';
      next.arrivedAt = time;
      next.progress = 1;
      events.push({ type: 'ARRIVED', agentId: agent.id });
    }
  }

  if (next.phase === 'EN_ROUTE') {
    if (time > next.departedAt) next.travelWorkMs = Math.min(next.plan.durationMs, next.travelWorkMs + tickMs * speedFactor);
    next.progress = Math.min(next.travelWorkMs / next.plan.durationMs, 0.98);
    if (next.travelWorkMs >= next.plan.durationMs) {
      next.phase = 'AWAITING_ARRIVAL';
      next.arrivalRequestedAt = time;
      send(arrivalAtc, 'ARRIVAL_REQUEST', { planId: next.plan.id });
    }
  }

  const waiting = ['REQUESTING_DEPARTURE', 'AWAITING_CONFIRMATION', 'AWAITING_ARRIVAL'].includes(next.phase);
  if (next.phase === 'WAITING' || (waiting && time - next.lastSentAt >= timeoutMs)) {
    if (waiting) {
      next.timeouts += 1;
      events.push({ type: 'REQUEST_TIMEOUT', agentId: agent.id });
    }
    if (next.phase === 'AWAITING_CONFIRMATION') {
      send(departureAtc, 'PLAN_ACCEPT', { planId: next.plan.id });
    } else if (next.phase === 'AWAITING_ARRIVAL') {
      send(arrivalAtc, 'ARRIVAL_REQUEST', { planId: next.plan.id });
    } else {
      next.phase = 'REQUESTING_DEPARTURE';
      send(departureAtc, 'DEPARTURE_REQUEST', {
        origin: agent.flight.airport_dep, destination: agent.flight.airport_dest,
        durationMs: agent.flight.est_flight_dur * 60_000,
      });
    }
  }
  return { next, outgoing, events };
}

export function decideAtcBase(agent) {
  const next = { ...agent, inbox: [], plans: { ...agent.plans } };
  const outgoing = [];
  const { messages, events } = uniqueInbox(agent);
  const send = (to, type, payload) => outgoing.push({ from: agent.id, to, type, payload });
  for (const message of messages) {
    if (message.type === 'DEPARTURE_REQUEST' && message.payload.origin === agent.airport) {
      const plan = next.plans[message.from] ?? {
        id: `${agent.id}:${message.from}:v1`,
        route: [message.payload.origin, message.payload.destination],
        durationMs: message.payload.durationMs,
      };
      next.plans[message.from] = plan;
      send(message.from, 'PLAN_OFFER', { plan });
    }
    if (message.type === 'PLAN_ACCEPT' && next.plans[message.from]?.id === message.payload.planId) {
      send(message.from, 'PLAN_CONFIRMED', { planId: message.payload.planId });
    }
    if (message.type === 'ARRIVAL_REQUEST') {
      send(message.from, 'ARRIVAL_APPROVED', { planId: message.payload.planId });
    }
  }
  return { next, outgoing, events };
}
