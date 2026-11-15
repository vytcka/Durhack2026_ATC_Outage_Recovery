// Seeded background disruptions, so a run is never just planes flying: storm cells that force
// detours, headwinds and runway holds that cause delays, airport closures that force diversions,
// ATC backlog and link outages (lost contact), packet-loss bursts, demand surges and fuel burn.
// Deterministic for a given seed, flight list and level. Every event satisfies the engine's own
// validation: valid target kind, value inside the factor's bounds, window inside the run.
import { DISRUPTION_FACTORS } from './factorCatalogue.js';
import { SIMULATION_MS, scheduledDepartureMs } from './timing.js';

export const AUTO_DISRUPTION_LEVELS = [
  { id: 'off', label: 'Off' },
  { id: 'light', label: 'Light' },
  { id: 'moderate', label: 'Moderate' },
  { id: 'heavy', label: 'Heavy' },
];

// Shares are fractions of the flights; the rest are event counts for the whole run.
const PLAN = {
  light: { storms: 0.05, headwinds: 0.05, fuel: 0, runwayHolds: 1, closures: 1, backlogs: 0, outages: 1, lossBursts: 1, surges: 0 },
  moderate: { storms: 0.12, headwinds: 0.1, fuel: 0.02, runwayHolds: 3, closures: 2, backlogs: 2, outages: 2, lossBursts: 2, surges: 1 },
  heavy: { storms: 0.2, headwinds: 0.18, fuel: 0.04, runwayHolds: 5, closures: 4, backlogs: 4, outages: 4, lossBursts: 4, surges: 2 },
};

const MINUTE_MS = 60_000;
// Departure handshake: the engine's first tick plus four message hops before take-off.
const DEPARTURE_HANDSHAKE_MS = 50_000;
const FACTOR = Object.fromEntries(DISRUPTION_FACTORS.map(factor => [factor.id, factor]));

// Small, fast, seedable PRNG (mulberry32) keyed by a string hash of the inputs.
function randomSource(key) {
  let state = 2166136261;
  for (let i = 0; i < key.length; i += 1) state = Math.imul(state ^ key.charCodeAt(i), 16777619);
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const between = (random, min, max) => min + (max - min) * random();

// Clamp into the factor's bounds and snap to its step, so the engine never rejects a value.
function factorValue(factorId, value) {
  const { min, max, step } = FACTOR[factorId];
  const snapped = Math.round(Math.min(max, Math.max(min, value)) / step) * step;
  return step >= 1 ? Math.round(snapped) : Number(Math.min(max, Math.max(min, snapped)).toFixed(3));
}

// k distinct items, in a seeded order.
function sample(random, items, k) {
  const pool = [...items];
  const picked = [];
  while (picked.length < k && pool.length) picked.push(...pool.splice(Math.floor(random() * pool.length), 1));
  return picked;
}

const pick = (random, items) => items[Math.floor(random() * items.length)];
const clock = ms => `${String(Math.floor(ms / 3_600_000)).padStart(2, '0')}:${String(Math.floor(ms / MINUTE_MS) % 60).padStart(2, '0')}`;

/**
 * @param flights the map's flight list, in agent order (agent id = `aircraft:<index>`)
 * @param options.seed scenario seed; options.level one of AUTO_DISRUPTION_LEVELS ids
 * @returns engine disruption events tagged `source: 'auto'`, sorted by start time
 */
export function generateAutoDisruptions(flights, { seed = 1, level = 'moderate', runMs = SIMULATION_MS } = {}) {
  const plan = PLAN[level];
  if (!plan || !flights?.length) return [];
  const random = randomSource(`${seed}:${level}:${flights.length}:${flights.map(flight => flight.flight_number).join(',')}`);
  const events = [];
  let sequence = 0;

  // Rejects windows the engine would refuse: negative start, empty, or past the end of the run.
  const add = (kind, factor, startMs, endMs, value, agentId, label) => {
    const start = Math.max(0, Math.round(startMs / 1000) * 1000);
    const end = Math.min(runMs, Math.round(endMs / 1000) * 1000);
    if (!(end > start)) return;
    events.push({ id: `auto-${kind}-${++sequence}`, factor, startMs: start, endMs: end,
      value: factorValue(factor, value), ...(agentId ? { agentId } : {}), source: 'auto', label });
  };

  const legs = flights.map((flight, index) => {
    const departAt = scheduledDepartureMs(flight) + DEPARTURE_HANDSHAKE_MS;
    const durationMs = flight.est_flight_dur * MINUTE_MS;
    return { flight, agentId: `aircraft:${index}`, departAt, durationMs, arriveAt: departAt + durationMs };
  }).filter(leg => Number.isFinite(leg.durationMs) && leg.durationMs > 0 && leg.departAt < runMs);
  if (!legs.length) return [];
  const count = share => Math.max(1, Math.round(share * legs.length));
  const destinations = [...new Set(legs.map(leg => leg.flight.airport_dest))].sort();

  // Storm cells ahead of a plane: it holds at the boundary, negotiates a bypass, flies longer.
  // Active from shortly after take-off until well after it reaches the boundary.
  const stormLegs = legs.filter(leg => leg.flight.est_flight_dur >= 40 && leg.departAt + leg.durationMs * 0.7 < runMs);
  for (const leg of sample(random, stormLegs, count(plan.storms))) {
    const boundary = factorValue('NO_GO_REGION', between(random, 0.3, 0.6));
    add('storm', 'NO_GO_REGION', leg.departAt + 2 * MINUTE_MS,
      leg.departAt + leg.durationMs * (boundary + 0.3) + 3 * MINUTE_MS, boundary, leg.agentId,
      `Storm cell across ${leg.flight.flight_number}'s route at ${Math.round(boundary * 100)}%`);
  }

  // Headwinds on the whole trip: slower ground progress, a measured en-route delay.
  for (const leg of sample(random, legs, count(plan.headwinds))) {
    const penalty = factorValue('HEADWIND', between(random, 0.2, 0.4));
    add('headwind', 'HEADWIND', leg.departAt, leg.arriveAt + leg.durationMs * 0.6, penalty, leg.agentId,
      `Headwind on ${leg.flight.flight_number} (−${Math.round(penalty * 100)}% ground speed)`);
  }

  // Extra fuel burn: virtual reserve drains, which can raise priority or an alternate request.
  if (plan.fuel > 0) {
    for (const leg of sample(random, legs, count(plan.fuel))) {
      const burn = factorValue('FUEL_CONSUMPTION', between(random, 2, 3));
      add('fuel', 'FUEL_CONSUMPTION', leg.departAt, leg.arriveAt + 30 * MINUTE_MS, burn, leg.agentId,
        `Fuel leak on ${leg.flight.flight_number} (×${burn} burn)`);
    }
  }

  // Runway holds at an origin around a scheduled departure: ground delays, held arrivals.
  for (const leg of sample(random, legs, plan.runwayHolds)) {
    const lengthMs = between(random, 10, 25) * MINUTE_MS;
    const startMs = leg.departAt - 2 * MINUTE_MS;
    add('runway', 'RUNWAY_CLOSURE', startMs, startMs + lengthMs, 1, `atc:${leg.flight.airport_dep}`,
      `Runway closed at ${leg.flight.airport_dep} from ${clock(Math.max(0, startMs))}`);
  }

  // Airport closures that start while a long flight is en route there: diversions.
  const closureLegs = legs.filter(leg => leg.flight.est_flight_dur >= 45);
  for (const leg of sample(random, closureLegs, plan.closures)) {
    const startMs = leg.departAt + leg.durationMs * 0.35;
    add('closure', 'AIRPORT_CLOSURE', startMs, startMs + between(random, 20, 40) * MINUTE_MS, 1,
      `atc:${leg.flight.airport_dest}`, `${leg.flight.airport_dest} closed from ${clock(startMs)}`);
  }

  // ATC processing backlog at a destination, around a scheduled arrival.
  for (const leg of sample(random, legs, plan.backlogs)) {
    const startMs = leg.arriveAt - 10 * MINUTE_MS;
    const budget = factorValue('ATC_BACKLOG', between(random, 1, 2.49));
    add('backlog', 'ATC_BACKLOG', startMs, startMs + between(random, 30, 60) * MINUTE_MS, budget,
      `atc:${leg.flight.airport_dest}`, `${leg.flight.airport_dest} ATC backlog (${budget} request${budget === 1 ? '' : 's'} per tick)`);
  }

  // ATC link outage at a destination mid-flight: inbound aircraft lose contact and run their
  // lost-comms procedure. Longer than two timeouts so the loss is actually detected.
  for (const leg of sample(random, closureLegs, plan.outages)) {
    const startMs = leg.departAt + leg.durationMs * 0.3;
    add('outage', 'ATC_LINK_OUTAGE', startMs, startMs + between(random, 4, 9) * MINUTE_MS, 1,
      `atc:${leg.flight.airport_dest}`, `${leg.flight.airport_dest} ATC radio outage from ${clock(startMs)}`);
  }

  // Network-wide packet-loss bursts at random times while traffic is flowing.
  const busyUntil = Math.min(runMs, Math.max(...legs.map(leg => leg.arriveAt)));
  for (let i = 0; i < plan.lossBursts; i += 1) {
    const startMs = between(random, 0, Math.max(MINUTE_MS, busyUntil - 15 * MINUTE_MS));
    const loss = factorValue('PACKET_LOSS', between(random, 0.2, 0.4));
    add('loss', 'PACKET_LOSS', startMs, startMs + between(random, 5, 15) * MINUTE_MS, loss, undefined,
      `${Math.round(loss * 100)}% packet loss from ${clock(startMs)}`);
  }

  // Arrival demand surges at busy destinations.
  for (let i = 0; i < plan.surges && destinations.length; i += 1) {
    const airport = pick(random, destinations);
    const inbound = legs.filter(leg => leg.flight.airport_dest === airport);
    const startMs = pick(random, inbound).arriveAt - 15 * MINUTE_MS;
    const demand = factorValue('DEMAND_SURGE', between(random, 6, 12));
    add('surge', 'DEMAND_SURGE', startMs, startMs + 20 * MINUTE_MS, demand, `atc:${airport}`,
      `Arrival surge at ${airport} (${demand} extra per minute)`);
  }

  return events.sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id));
}
