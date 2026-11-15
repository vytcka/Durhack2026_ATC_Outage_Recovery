// Reads the engine's per-tick message list (snapshot.comms) for the radio-link symbol drawn above
// each aircraft and for the footer/analytics counts.
// Pure: no React or geography, so this runs under `node --test`.

// Radio-link symbol states, in legend order.
export const LINK_STATES = [
  { id: 'live', label: 'In contact', description: 'radio link to its controller is working; the outer wave pulses while a message is being exchanged' },
  { id: 'lost', label: 'Communication lost', description: 'no word from its controller for 2 minutes (lost-comms procedure running), still squawking 7600, or every message it touched this tick was lost' },
];

const isAtc = id => typeof id === 'string' && id.startsWith('atc:');
const isAircraft = id => typeof id === 'string' && id.startsWith('aircraft:');

// Which way a message travels and between what kinds of node; dropped messages are their own kind.
export function commsKind(link) {
  if (link?.status === 'dropped') return 'dropped';
  const fromAtc = isAtc(link?.from);
  const toAtc = isAtc(link?.to);
  if (!fromAtc && !toAtc) return 'peer';
  return toAtc ? 'uplink' : 'downlink';
}

// Readable message type: "DESTINATION_STATUS_REQUEST" -> "destination status request".
export function messageLabel(type) {
  return String(type ?? 'message').toLowerCase().replaceAll('_', ' ');
}

// Per aircraft, this tick: did it take part in a message that is moving or arrived (`active`),
// and was any of its messages lost (`dropped`)? Both ends of a link count.
export function trafficByAgent(comms) {
  const traffic = new Map();
  for (const link of comms ?? []) {
    for (const id of [link?.from, link?.to]) {
      if (!isAircraft(id)) continue;
      const entry = traffic.get(id) ?? { active: false, dropped: false };
      if (link.status === 'dropped') entry.dropped = true;
      else entry.active = true;
      traffic.set(id, entry);
    }
  }
  return traffic;
}

// The symbol above one plane: `state` is 'live' or 'lost' (null once landed or before the first
// snapshot); `transmitting` is true while it is exchanging a message this tick.
export function linkState(agent, traffic) {
  if (!agent || agent.phase === 'ARRIVED') return { state: null, transmitting: false };
  const lost = Boolean(agent.procedureState?.active) || agent.squawk === '7600'
    || Boolean(traffic?.dropped && !traffic?.active);
  return { state: lost ? 'lost' : 'live', transmitting: Boolean(traffic?.active) && !lost };
}

// Counts by status and kind for the footer and the analytics panel.
export function summariseComms(comms) {
  const summary = { inFlight: 0, delivered: 0, dropped: 0, uplink: 0, downlink: 0, peer: 0 };
  for (const link of comms ?? []) {
    if (link.status === 'in-flight') summary.inFlight += 1;
    else if (link.status === 'delivered') summary.delivered += 1;
    else if (link.status === 'dropped') summary.dropped += 1;
    const kind = commsKind({ ...link, status: undefined });
    summary[kind] += 1;
  }
  return summary;
}
