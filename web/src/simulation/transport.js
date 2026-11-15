import { activeDisruptions } from './disruptions.js';

export function drawFor(seed, message, purpose) {
  let hash = 2166136261;
  const key = `${seed}:${message.from}:${message.to}:${message.type}:${message.sentAt}:${purpose}`;
  for (let i = 0; i < key.length; i += 1) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
  return (hash >>> 0) / 4294967296;
}

export function transportEffects(events, message, time, seed) {
  const active = activeDisruptions(events, message, time);
  const atcUp = message.to.startsWith('atc:');
  const atcDown = message.from.startsWith('atc:');
  const ack = ['PLAN_ACCEPT', 'PLAN_CONFIRMED', 'ARRIVAL_APPROVED', 'ALTERNATE_APPROVED', 'REROUTE_APPROVED', 'HANDOVER_ACK'].includes(message.type);
  const has = id => active.some(event => event.factor === id);
  return {
    drop: (!atcUp && !atcDown && has('AIRCRAFT_LINK_OUTAGE'))
      || (has('HANDOVER_FAILURE') && message.type === 'HANDOVER_ACK')
      || active.some(event => (event.factor === 'ONE_WAY_FAILURE' && (event.value === 1 ? atcUp : atcDown))
        || (event.factor === 'LOST_ACK' && ack && drawFor(seed, message, event.id) < event.value)),
    corrupted: active.some(event => event.factor === 'CORRUPTED_PAYLOAD' && drawFor(seed, message, event.id) < event.value),
    copies: Math.max(0, ...active.filter(event => event.factor === 'DUPLICATE_MESSAGE').map(event => event.value)),
    jitterMs: active.filter(event => event.factor === 'OUT_OF_ORDER')
      .reduce((sum, event) => sum + Math.floor(drawFor(seed, message, event.id) * event.value), 0),
  };
}

export function uniqueInbox(agent) {
  const seen = new Set();
  const messages = [];
  const events = [];
  for (const message of agent.inbox) {
    if (message.corrupted || !message.payload) {
      events.push({ type: 'MESSAGE_REJECTED', agentId: agent.id });
      continue;
    }
    if (seen.has(message.logicalId ?? message.id)) continue;
    seen.add(message.logicalId ?? message.id);
    messages.push(message);
  }
  return { messages, events };
}
