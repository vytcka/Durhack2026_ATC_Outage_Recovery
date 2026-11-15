// Simple flight profile: climb, cruise, descent.
//
// The agent engine decides *when* a plane departs and lands and reports `progress`, the share of
// nominal flight time completed (0..1). This module turns that into what a plane would be doing
// at that moment: altitude, speed, vertical rate, fuel, and how far along the route it actually is.
//
// Arrival timing never changes: whatever the speed profile, routeFraction is 0 at departure and 1 at
// landing. Speed only changes how the distance is spread over the trip (slow near the airports,
// fast in cruise).

const CLIMB_MINUTES = 20;
const DESCENT_MINUTES = 25;
// Short hops never reach a long cruise, so climb/descent are capped as a share of the trip.
const MAX_CLIMB_SHARE = 0.3;
const MAX_DESCENT_SHARE = 0.35;

const TAKEOFF_SPEED_KT = 160;
const LANDING_SPEED_KT = 140;
const MIN_CRUISE_SPEED_KT = 450; // the snapshot may have caught a plane slowing down for approach
const MIN_CRUISE_FL = 200;       // ...or still climbing, so don't trust a low recorded altitude

const AIRBORNE_PHASES = ['EN_ROUTE', 'AWAITING_ARRIVAL'];

// Everything that depends only on the flight record, not on time.
function profileOf(flight) {
  const minutes = flight.est_flight_dur;
  const climbEnd = Math.min(CLIMB_MINUTES / minutes, MAX_CLIMB_SHARE);
  const descentStart = 1 - Math.min(DESCENT_MINUTES / minutes, MAX_DESCENT_SHARE);

  return {
    minutes,
    climbEnd,
    descentStart,
    cruiseFt: Math.max(flight.altitude, MIN_CRUISE_FL) * 100,
    cruiseKt: Math.max(flight.airspeed, MIN_CRUISE_SPEED_KT),
  };
}

// Smooth 0 -> 1 curve with zero slope at both ends, so climbs and descents ease in and out.
const smoothstep = (x) => x * x * (3 - 2 * x);
const smoothstepSlope = (x) => 6 * x * (1 - x);
const lerp = (a, b, x) => a + (b - a) * x;

// Speed rises linearly during the climb, holds in cruise, and falls linearly during the descent.
function speedAt(profile, p) {
  const { climbEnd, descentStart, cruiseKt } = profile;
  if (p < climbEnd) return lerp(TAKEOFF_SPEED_KT, cruiseKt, p / climbEnd);
  if (p <= descentStart) return cruiseKt;
  return lerp(cruiseKt, LANDING_SPEED_KT, (p - descentStart) / (1 - descentStart));
}

// Distance travelled up to p is the area under the speed curve. The curve is made of straight
// pieces, so each area is a rectangle plus a triangle and can be written down directly.
function distanceAt(profile, p) {
  const { climbEnd: c, descentStart: d, cruiseKt: vc } = profile;
  const climbArea = (x) => TAKEOFF_SPEED_KT * x + ((vc - TAKEOFF_SPEED_KT) * x * x) / (2 * c);
  const descentArea = (x) => vc * x - ((vc - LANDING_SPEED_KT) * x * x) / (2 * (1 - d));

  if (p <= c) return climbArea(p);
  if (p <= d) return climbArea(c) + vc * (p - c);
  return climbArea(c) + vc * (d - c) + descentArea(p - d);
}

// Altitude (ft) and vertical rate (ft/min) at progress p.
function verticalAt(profile, p) {
  const { minutes, climbEnd, descentStart, cruiseFt } = profile;

  if (p < climbEnd) {
    const x = p / climbEnd;
    return { altitudeFt: cruiseFt * smoothstep(x), verticalRate: (cruiseFt * smoothstepSlope(x)) / (climbEnd * minutes) };
  }
  if (p <= descentStart) {
    return { altitudeFt: cruiseFt, verticalRate: 0 };
  }
  const x = (p - descentStart) / (1 - descentStart);
  const descentMinutes = (1 - descentStart) * minutes;
  return { altitudeFt: cruiseFt * (1 - smoothstep(x)), verticalRate: (-cruiseFt * smoothstepSlope(x)) / descentMinutes };
}

function flightPhase(agent, p, profile) {
  if (agent.phase === 'AWAITING_ARRIVAL') return 'HOLDING';
  if (p < profile.climbEnd) return 'CLIMB';
  if (p <= profile.descentStart) return 'CRUISE';
  return 'DESCENT';
}

// Live state of one aircraft. `agent` is the engine snapshot for this flight.
export function flightPhysics(flight, agent) {
  const p = Math.min(Math.max(agent.progress, 0), 1);
  const fuelKg = Math.round(flight.fuel_remaining * (agent.reserve ?? 1));

  if (!AIRBORNE_PHASES.includes(agent.phase)) {
    return { phase: 'GROUND', routeFraction: p, altitudeFt: 0, groundSpeedKt: 0, verticalRate: 0, fuelKg };
  }

  const profile = profileOf(flight);

  // A diversion flies back along the route (progress decreasing), so the climb/descent
  // profile doesn't apply; keep it simple and show it at cruise.
  if (agent.diverted) {
    return { phase: 'DIVERTING', routeFraction: p, altitudeFt: profile.cruiseFt, groundSpeedKt: profile.cruiseKt, verticalRate: 0, fuelKg };
  }

  const phase = flightPhase(agent, p, profile);
  const { altitudeFt, verticalRate } = verticalAt(profile, p);

  return {
    phase,
    routeFraction: distanceAt(profile, p) / distanceAt(profile, 1),
    altitudeFt: Math.round(altitudeFt),
    groundSpeedKt: Math.round(speedAt(profile, p)),
    // A holding plane circles at a constant level.
    verticalRate: phase === 'HOLDING' ? 0 : Math.round(verticalRate),
    fuelKg,
  };
}

// Below 18,000 ft altitudes are given in feet, above it as flight levels.
export function formatAltitude(altitudeFt) {
  if (altitudeFt <= 0) return 'Ground';
  if (altitudeFt < 18_000) return `${Math.round(altitudeFt / 100) * 100} ft`;
  return `FL${Math.round(altitudeFt / 100)}`;
}
