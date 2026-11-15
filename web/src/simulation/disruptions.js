export { DISRUPTION_FACTORS } from './factorCatalogue.js';

export function activeDisruptions(disruptions, message, time) {
  return disruptions.filter(event => time >= event.startMs && time < event.endMs
    && (!event.agentId || event.agentId === message.from || event.agentId === message.to));
}

export function isLinkDown(disruptions, message, time) {
  return activeDisruptions(disruptions, message, time).some(event => event.factor === 'ATC_LINK_OUTAGE'
    && (message.from.startsWith('atc:') || message.to.startsWith('atc:')));
}

// Key each draw to message meaning and simulated time, not agent iteration order.
export function packetLost(disruptions, message, time, seed) {
  let hash = 2166136261;
  const key = `${seed}:${message.from}:${message.to}:${message.type}:${time}`;
  for (let i = 0; i < key.length; i += 1) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
  const draw = (hash >>> 0) / 4294967296;
  return activeDisruptions(disruptions, message, time).some(event => event.factor === 'PACKET_LOSS' && draw < event.value);
}
