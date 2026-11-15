// Lost-comms holding orbit, drawn while a plane's procedure is on a CIRCLE (CircleAround) or HOLD block.
// The engine stops route progress; the map flies the plane round a circle so the hold is visible.
// Pure: the caller supplies the hold pose and the radius in map units, so this runs under `node --test`.

export const ORBIT_MINUTES = 4;      // one full circuit
export const ORBIT_RADIUS_NM = 5;
const ORBIT_COMMANDS = new Set(['CIRCLE', 'HOLD']);
const toRadians = degrees => degrees * Math.PI / 180;
const isPoint = point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite);

// The block the agent is executing right now: { step, index, startedAt }, or null.
export function activeProcedureStep(agent) {
  const state = agent?.procedureState;
  if (!state?.active || !Number.isInteger(state.stepIndex)) return null;
  const step = agent.procedure?.steps?.[state.stepIndex];
  return step ? { step, index: state.stepIndex, startedAt: state.stepStartedAt } : null;
}

// Minutes left in a timed block at simulation time `time`; null for instant or terminal blocks.
export function stepRemainingMinutes(active, time) {
  if (!active || !Number.isFinite(active.step?.minutes) || !Number.isFinite(active.startedAt) || !Number.isFinite(time)) return null;
  return Math.max(0, active.step.minutes - (time - active.startedAt) / 60_000);
}

// True while the plane should be drawn circling.
export function isOrbiting(agent) {
  return ORBIT_COMMANDS.has(activeProcedureStep(agent)?.step.command);
}

// Right-hand orbit that starts exactly at the hold point, flying the plane's own heading, so the
// icon turns into the circle instead of jumping onto it.
//   hold:        { position: [x, y], heading } where the plane stopped on its route (0° = up, clockwise)
//   radiusUnits: orbit radius in map units
//   elapsedMs:   time since the block started
// Returns { center, radius, position, heading } or null for unusable input.
export function holdingOrbit(hold, { radiusUnits, elapsedMs, periodMs = ORBIT_MINUTES * 60_000 } = {}) {
  if (!isPoint(hold?.position) || !Number.isFinite(hold.heading) || !(radiusUnits > 0) || !(periodMs > 0)) return null;
  const heading = toRadians(hold.heading);
  const right = [Math.cos(heading), Math.sin(heading)]; // 90° clockwise from the direction of flight
  const center = [hold.position[0] + radiusUnits * right[0], hold.position[1] + radiusUnits * right[1]];
  const start = [-radiusUnits * right[0], -radiusUnits * right[1]]; // hold point relative to the centre
  const elapsed = Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0) % periodMs;
  const angle = 2 * Math.PI * elapsed / periodMs;
  // With screen y pointing down this rotation is clockwise, i.e. a right-hand turn.
  const relative = [start[0] * Math.cos(angle) - start[1] * Math.sin(angle), start[0] * Math.sin(angle) + start[1] * Math.cos(angle)];
  const velocity = [-relative[1], relative[0]];
  return {
    center,
    radius: radiusUnits,
    position: [center[0] + relative[0], center[1] + relative[1]],
    heading: Math.atan2(velocity[0], -velocity[1]) * 180 / Math.PI,
  };
}
