import { diversionLeg, displayPose, isPoint, pathOf, routePoint, sampleRoute } from './flightGeometry.js';

// Explanatory guides drawn from the plane's CURRENT position:
// - diversion: dashed straight line to the abandoned destination, solid straight line to the new airport;
// - detour: dashed original curve (joined to the plane) and solid detour curve to the same destination.
// Pure map-space geometry; `project` maps [lon, lat] to map coordinates and is injected by the caller.
export function routeChangeGeometry(flight, agent, { project, samples = 40 } = {}) {
  if (!Array.isArray(flight?.curve) || flight.curve.length !== 3 || !flight.curve.every(isPoint) || !agent) return null;
  const oldDestination = flight.curve[2];

  if (agent.diverted) {
    const leg = diversionLeg(flight, agent, project);
    if (!leg) return null;
    const from = displayPose(flight, agent, project).position;
    const diversion = agent.diversion;
    return {
      type: 'diversion',
      changedAt: Number.isFinite(diversion.startedAt) ? diversion.startedAt : null,
      from, turn: leg.turn, oldDestination, newDestination: leg.to,
      previousAirport: diversion.previousAirport ?? flight.airport_dest ?? null,
      newAirport: diversion.airport ?? agent.arrivalAirport ?? null,
      trigger: diversion.trigger ?? null,
      oldPath: `M${from} L${oldDestination}`,
      newPath: `M${from} L${leg.to}`,
      arrowAngle: endAngle(from, leg.to) ?? endAngle(leg.turn, leg.to),
    };
  }

  const reroute = agent.reroute;
  if (!reroute || !Number.isFinite(reroute.startProgress)) return null;
  const start = Math.min(1, Math.max(0, reroute.startProgress));
  const progress = Math.min(1, Math.max(start, Number.isFinite(agent.progress) ? agent.progress : start));
  // Both guides hang off the plane: the solid detour runs on from its position, and the dashed
  // original plan joins it with a short step back to the original route at the same progress.
  const detour = sampleRoute(flight, progress, 1, reroute, samples);
  const original = [detour[0], ...sampleRoute(flight, progress, 1, undefined, samples)];
  const turn = routePoint(flight, start).position;
  if (!original.every(isPoint) || !detour.every(isPoint) || !isPoint(turn)) return null;
  return {
    type: 'reroute',
    changedAt: Number.isFinite(reroute.approvedAt) ? reroute.approvedAt : null,
    from: detour[0], turn, oldDestination, newDestination: oldDestination,
    previousAirport: flight.airport_dest ?? null, newAirport: flight.airport_dest ?? null,
    trigger: reroute.reason ?? null,
    oldPath: pathOf(original),
    newPath: pathOf(detour),
    arrowAngle: endAngle(detour[samples - 1], detour[samples]),
  };
}

// 1 right after the change, fading to 0 over `fadeMs` of completed simulation time
// (no timers, so pause/rewind behave). Used only for a brief emphasis ring; the guide lines persist.
export function routeChangeEmphasis(time, changedAt, fadeMs = 180_000) {
  if (!Number.isFinite(time) || !Number.isFinite(changedAt)
    || !Number.isFinite(fadeMs) || fadeMs <= 0 || time < changedAt) return 0;
  return Math.max(0, 1 - (time - changedAt) / fadeMs);
}

// Screen-space angle (degrees, SVG rotate convention) of the last segment, for arrowheads.
export function endAngle(from, to) {
  if (!isPoint(from) || !isPoint(to) || Math.hypot(to[0] - from[0], to[1] - from[1]) < 1e-9) return null;
  return Math.atan2(to[1] - from[1], to[0] - from[0]) * 180 / Math.PI;
}
