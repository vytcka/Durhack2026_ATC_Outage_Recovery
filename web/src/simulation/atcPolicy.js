import { decideAtcBase } from './agents.js';
import { uniqueInbox } from './transport.js';

export function decideAtc(agent, time, tickMs, timeoutMs, environment) {
  if (time < (agent.offlineUntil ?? 0) || time < (agent.readyAt ?? 0)) return { next: agent, outgoing: [], events: [] };
  const { messages, events } = uniqueInbox(agent);
  const next = { ...agent, inbox: [], priorities: { ...agent.priorities }, readyAt: time + environment.decisionDelayMs };
  const outgoing = [];
  const eligible = [];
  const routes = new Map();
  const respond = (message, type, payload) => {
    const reply = { from: agent.id, to: message.from, type, payload };
    outgoing.push(message.relayVia
      ? { from: agent.id, to: message.relayVia, type: 'RELAY_DOWN', payload: { message: reply } }
      : reply);
  };
  const logical = [...new Map(messages.map(envelope => {
    const inner = envelope.type === 'RELAY_UP' ? envelope.payload.message : null;
    const message = inner?.to === agent.id && inner.from?.startsWith('aircraft:')
      ? { ...envelope, ...inner, relayVia: envelope.from } : envelope;
    return [`${message.from}:${message.type}`, message];
  })).values()].sort((a, b) => Number(Boolean(b.payload.priority || next.priorities[b.from]))
    - Number(Boolean(a.payload.priority || next.priorities[a.from])) || (a.sentAt ?? 0) - (b.sentAt ?? 0));

  const minute = Math.floor(time / 60_000);
  let background = next.background ?? 0;
  if (environment.backgroundDemand && next.lastDemandMinute !== minute) {
    background += environment.backgroundDemand;
    next.lastDemandMinute = minute;
  }
  let arrivalServed = false;
  let processed = 0;
  for (const message of logical) {
    if (processed >= environment.processingBudget) { next.inbox.push(message); continue; }
    processed += 1;
    const isArrival = ['ARRIVAL_REQUEST', 'ALTERNATE_REQUEST'].includes(message.type);
    const usesRunway = isArrival || ['DEPARTURE_REQUEST', 'PLAN_ACCEPT'].includes(message.type);
    if (environment.closed && usesRunway) {
      respond(message, 'AIRPORT_UNAVAILABLE', { airport: agent.airport });
      continue;
    }
    if (environment.runwayClosed && usesRunway) { next.inbox.push(message); continue; }
    if (message.type === 'HANDOVER_REQUEST') { respond(message, 'HANDOVER_ACK', { planId: message.payload.planId }); continue; }
    if (message.type === 'PRIORITY_REQUEST') {
      next.priorities[message.from] = true;
      respond(message, 'PRIORITY_ACK', { planId: message.payload.planId });
      continue;
    }
    if (message.type === 'PLAN_ACCEPT' && !agent.plans[message.from]) {
      respond(message, 'PLAN_UNKNOWN', {});
      continue;
    }
    if (message.type === 'DEPARTURE_REQUEST' || isArrival) {
      const report = message.payload.report;
      const expected = message.type === 'DEPARTURE_REQUEST' ? 0 : 0.98;
      if (!report || Math.abs(time - report.observedAt) > timeoutMs || Math.abs(report.progress - expected) > 0.12) {
        events.push({ type: 'MESSAGE_REJECTED', reason: 'invalid position report', agentId: agent.id });
        continue;
      }
    }
    if (isArrival) {
      const priority = Boolean(message.payload.priority || next.priorities[message.from]);
      const alternate = message.type === 'ALTERNATE_REQUEST' || message.payload.diverted;
      const interval = Math.max(environment.arrivalIntervalMs, alternate ? environment.alternateIntervalMs : 0,
        (environment.backgroundDemand || logical.some(item => item.payload.priority)) ? tickMs : 0);
      if (time < (next.nextArrivalAt ?? 0) || (background > 0 && !priority) || (interval > 0 && arrivalServed)) {
        next.inbox.push(message); continue;
      }
      if (interval > 0) { arrivalServed = true; next.nextArrivalAt = time + interval; }
      if (message.type === 'ALTERNATE_REQUEST') {
        respond(message, 'ALTERNATE_APPROVED', { planId: message.payload.planId, airport: agent.airport });
        events.push({ type: 'ALTERNATE_RESERVED', agentId: agent.id });
        continue;
      }
    }
    if (message.relayVia) routes.set(message.from, message.relayVia);
    eligible.push(message);
  }
  if (background > 0 && !arrivalServed && !environment.closed && !environment.runwayClosed) background -= 1;
  next.background = background;
  const base = decideAtcBase({ ...next, inbox: eligible });
  const deferred = next.inbox;
  return {
    next: { ...base.next, inbox: deferred },
    outgoing: [...outgoing, ...base.outgoing.map(message => routes.has(message.to)
      ? { from: agent.id, to: routes.get(message.to), type: 'RELAY_DOWN', payload: { message } } : message)],
    events: [...events, ...base.events],
  };
}
