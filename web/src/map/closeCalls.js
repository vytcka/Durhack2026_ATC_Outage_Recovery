// Separation monitor over the planes as drawn on the map.
// - 'loss': two airborne planes are already closer than the separation minima.
// - 'predicted': holding course, speed and vertical rate, they will be closer than the minima
//   within the look-ahead (straight-line closest point of approach, CPA).
// Schematic: no TCAS logic, no real procedures, map-space positions converted with a local scale.
// Pure, so it runs under `node --test`; the caller supplies positions and the NM-per-unit scale.

export const SEPARATION = Object.freeze({ lateralNm: 5, verticalFt: 1000, lookaheadMin: 3 });

const toRadians = degrees => degrees * Math.PI / 180;

// NM per minute in map orientation: heading 0° = up (screen y decreases), clockwise.
function velocity(track) {
  const nmPerMinute = Math.max(0, track.speedKt ?? 0) / 60;
  const heading = toRadians(track.heading ?? 0);
  return [Math.sin(heading) * nmPerMinute, -Math.cos(heading) * nmPerMinute];
}

const finite = value => Number.isFinite(value);
const validTrack = track => Array.isArray(track?.position) && track.position.length === 2
  && track.position.every(finite) && finite(track.nmPerUnit) && track.nmPerUnit > 0 && finite(track.altitudeFt);

// tracks: [{ id, position: [x, y] (map units), heading (deg), speedKt, altitudeFt, verticalRate (ft/min), nmPerUnit }]
export function detectCloseCalls(tracks, options = {}) {
  const { lateralNm, verticalFt, lookaheadMin } = { ...SEPARATION, ...options };
  const valid = (tracks ?? []).filter(validTrack);
  const calls = [];
  for (let i = 0; i < valid.length; i += 1) {
    const a = valid[i];
    for (let j = i + 1; j < valid.length; j += 1) {
      const b = valid[j];
      // A gap this large cannot close within the look-ahead, even head-on at full speed.
      const verticalNow = Math.abs(b.altitudeFt - a.altitudeFt);
      const maxClimb = (Math.abs(a.verticalRate ?? 0) + Math.abs(b.verticalRate ?? 0)) * lookaheadMin;
      if (verticalNow - maxClimb >= verticalFt) continue;
      const scale = (a.nmPerUnit + b.nmPerUnit) / 2;
      const rx = (b.position[0] - a.position[0]) * scale;
      const ry = (b.position[1] - a.position[1]) * scale;
      const distanceNm = Math.hypot(rx, ry);
      const reachNm = lateralNm + (Math.max(0, a.speedKt ?? 0) + Math.max(0, b.speedKt ?? 0)) / 60 * lookaheadMin;
      if (distanceNm > reachNm) continue;

      const [avx, avy] = velocity(a);
      const [bvx, bvy] = velocity(b);
      const vx = bvx - avx;
      const vy = bvy - avy;
      const speed2 = vx * vx + vy * vy;
      const cpaMinutes = speed2 > 1e-12 ? Math.min(lookaheadMin, Math.max(0, -(rx * vx + ry * vy) / speed2)) : 0;
      const cpaNm = Math.hypot(rx + vx * cpaMinutes, ry + vy * cpaMinutes);
      const verticalAtCpa = Math.abs((b.altitudeFt + (b.verticalRate ?? 0) * cpaMinutes)
        - (a.altitudeFt + (a.verticalRate ?? 0) * cpaMinutes));

      let kind = null;
      if (distanceNm < lateralNm && verticalNow < verticalFt) kind = 'loss';
      else if (cpaMinutes > 0 && cpaNm < lateralNm && verticalAtCpa < verticalFt) kind = 'predicted';
      if (!kind) continue;
      calls.push({
        id: `${a.id}|${b.id}`, a: a.id, b: b.id, kind,
        distanceNm, verticalFt: verticalNow,
        cpaNm: kind === 'loss' ? Math.min(distanceNm, cpaNm) : cpaNm,
        cpaMinutes: kind === 'loss' ? 0 : cpaMinutes,
        verticalAtCpaFt: verticalAtCpa,
        from: [...a.position], to: [...b.position],
      });
    }
  }
  return calls.sort(compareCalls);
}

// Loss of separation first, then the soonest, then the closest.
export function compareCalls(first, second) {
  if (first.kind !== second.kind) return first.kind === 'loss' ? -1 : 1;
  return first.cpaMinutes - second.cpaMinutes || first.cpaNm - second.cpaNm || first.id.localeCompare(second.id);
}

// Worst call for every flight involved: Map(id → call).
export function closeCallsByFlight(calls) {
  const byFlight = new Map();
  for (const call of calls ?? []) {
    for (const id of [call.a, call.b]) {
      const current = byFlight.get(id);
      if (!current || compareCalls(call, current) < 0) byFlight.set(id, call);
    }
  }
  return byFlight;
}

// 1.67 -> "1m 40s", 0.5 -> "30s"
export function formatCpaTime(minutes) {
  const seconds = Math.max(0, Math.round((minutes ?? 0) * 60));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

// Map label at the midpoint of the two planes.
export function closeCallLabel(call) {
  if (call.kind === 'loss') return `${call.distanceNm.toFixed(1)} NM · ${Math.round(call.verticalFt / 100) * 100} ft`;
  return `CPA ${call.cpaNm.toFixed(1)} NM in ${formatCpaTime(call.cpaMinutes)}`;
}

// Tracker/card text from one plane's point of view, e.g. "Close call with UA12 · CPA 2.1 NM in 1m 05s".
export function describeCloseCall(call, selfId, nameOf = id => id) {
  if (!call) return null;
  const other = nameOf(call.a === selfId ? call.b : call.a);
  return call.kind === 'loss'
    ? `Loss of separation with ${other} · ${closeCallLabel(call)}`
    : `Close call with ${other} · ${closeCallLabel(call)}`;
}
