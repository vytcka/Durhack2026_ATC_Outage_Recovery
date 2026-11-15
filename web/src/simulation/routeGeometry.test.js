import test from 'node:test';
import assert from 'node:assert/strict';
import { routePose } from './routeGeometry.js';

const curve = [[0, 0], [50, 0], [100, 0]];
const detour = { startProgress: 0.2, endProgress: 0.98, offset: 0.18 };

test('a detour starts continuously at the current position and rejoins before landing', () => {
  assert.deepEqual(routePose(curve, 0.2, detour), routePose(curve, 0.2));
  assert.deepEqual(routePose(curve, 0.98, detour), routePose(curve, 0.98));
  assert.deepEqual(routePose(curve, 1, detour), routePose(curve, 1));
  const middle = routePose(curve, 0.59, detour).position;
  assert.ok(Math.abs(middle[1]) > 17);
  assert.ok(Math.abs(middle[0] - 59) < 0.001);
});
