import test from 'node:test';
import assert from 'node:assert/strict';
import { activeProcedureStep, holdingOrbit, isOrbiting, ORBIT_MINUTES, stepRemainingMinutes } from './holdingPattern.js';

const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} vs ${expected}`);
const procedure = { steps: [{ command: 'SQUAWK', code: '7600' }, { command: 'CIRCLE', minutes: 30 }, { command: 'DIVERT', target: 'NEAREST' }] };

test('the running block and its remaining minutes come from the procedure state', () => {
  const agent = { procedure, procedureState: { active: true, stepIndex: 1, stepStartedAt: 60_000 } };
  const active = activeProcedureStep(agent);
  assert.equal(active.step.command, 'CIRCLE');
  assert.equal(active.index, 1);
  assert.equal(stepRemainingMinutes(active, 60_000 + 10 * 60_000), 20);
  assert.equal(stepRemainingMinutes(active, 60_000 + 45 * 60_000), 0);
  assert.equal(isOrbiting(agent), true);
  assert.equal(isOrbiting({ procedure, procedureState: { active: true, stepIndex: 2, stepStartedAt: 0 } }), false);
  assert.equal(stepRemainingMinutes(activeProcedureStep({ procedure, procedureState: { active: true, stepIndex: 0, stepStartedAt: 0 } }), 0), null);
  assert.equal(activeProcedureStep({ procedure, procedureState: { active: false, stepIndex: 1 } }), null);
  assert.equal(activeProcedureStep(undefined), null);
});

test('the orbit starts at the hold point on the plane\'s own heading and turns right', () => {
  const hold = { position: [100, 100], heading: 90 }; // flying east (screen right)
  const start = holdingOrbit(hold, { radiusUnits: 10, elapsedMs: 0 });
  close(start.position[0], 100, 'start x');
  close(start.position[1], 100, 'start y');
  close(start.heading, 90, 'start heading');
  close(start.center[0], 100, 'centre x');
  close(start.center[1], 110, 'centre y (right of east is screen-down)');
  // A quarter of the way round a right-hand turn from heading east, the plane is heading south (180°).
  const quarter = holdingOrbit(hold, { radiusUnits: 10, elapsedMs: ORBIT_MINUTES * 60_000 / 4 });
  close(quarter.position[0], 110, 'quarter x');
  close(quarter.position[1], 110, 'quarter y');
  close(quarter.heading, 180, 'quarter heading');
});

test('the plane stays on the circle, heading along it, and repeats every period', () => {
  const hold = { position: [3, -7], heading: 37 };
  for (const elapsedMs of [10_000, 75_000, 130_000, 222_000]) {
    const orbit = holdingOrbit(hold, { radiusUnits: 4, elapsedMs });
    const radial = [orbit.position[0] - orbit.center[0], orbit.position[1] - orbit.center[1]];
    close(Math.hypot(...radial), 4, 'radius');
    const heading = orbit.heading * Math.PI / 180;
    const forward = [Math.sin(heading), -Math.cos(heading)];
    close(forward[0] * radial[0] + forward[1] * radial[1], 0, 'heading is tangent');
  }
  const once = holdingOrbit(hold, { radiusUnits: 4, elapsedMs: 50_000 });
  const again = holdingOrbit(hold, { radiusUnits: 4, elapsedMs: 50_000 + ORBIT_MINUTES * 60_000 });
  close(once.position[0], again.position[0], 'periodic x');
  close(once.position[1], again.position[1], 'periodic y');
});

test('unusable input gives no orbit', () => {
  assert.equal(holdingOrbit(null, { radiusUnits: 1, elapsedMs: 0 }), null);
  assert.equal(holdingOrbit({ position: [0, 0], heading: 0 }, { radiusUnits: NaN, elapsedMs: 0 }), null);
  assert.equal(holdingOrbit({ position: [0, NaN], heading: 0 }, { radiusUnits: 1, elapsedMs: 0 }), null);
});
