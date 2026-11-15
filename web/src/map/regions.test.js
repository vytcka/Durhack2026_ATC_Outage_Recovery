import test from 'node:test';
import assert from 'node:assert/strict';
import { regionStatus, stormRegions } from './regions.js';
import { routePose } from '../simulation/routeGeometry.js';

const flight = { agentId: 'aircraft:0', flight_number: 'F1', curve: [[0, 0], [50, -40], [100, 0]] };
const storm = { id: 'auto-storm-1', factor: 'NO_GO_REGION', value: 0.4, agentId: 'aircraft:0' };
const agent = overrides => ({ id: 'aircraft:0', phase: 'EN_ROUTE', progress: 0.2, reroute: null, diverted: false,
  activeFactors: [storm], ...overrides });

test('an active storm becomes a closed corridor starting at the route edge', () => {
  const [region] = stormRegions([flight], { 'aircraft:0': agent() }, { 'auto-storm-1': { endMs: 3 * 3_600_000 } });
  assert.equal(region.boundary, 0.4);
  assert.deepEqual(region.edge, routePose(flight.curve, 0.4).position);
  assert.ok(region.corridorPath.startsWith(`M${routePose(flight.curve, 0.4).position}`));
  // Same arithmetic as the module (0.4 + 0.3 is not exactly 0.7 in floating point).
  assert.ok(region.corridorPath.endsWith(`L${routePose(flight.curve, 0.4 + 0.3).position}`));
  assert.equal(region.status, 'ahead');
  assert.match(region.label, /closed from 40%/);
  assert.match(region.detail, /clears 03:00/);
});

test('status follows the plane: ahead, holding at the edge, then bypassing on a detour', () => {
  assert.equal(regionStatus(agent(), 0.4), 'ahead');
  assert.equal(regionStatus(agent({ progress: 0.4 }), 0.4), 'holding');
  assert.equal(regionStatus(agent({ progress: 0.45, reroute: { boundary: 0.4 } }), 0.4), 'bypassed');
  assert.equal(regionStatus(agent({ phase: 'REQUESTING_DEPARTURE', progress: 0 }), 0.4), 'ahead');
});

test('no region for landed, diverted or unaffected planes, or other factors', () => {
  const none = agents => stormRegions([flight], { 'aircraft:0': agents });
  assert.deepEqual(none(agent({ phase: 'ARRIVED' })), []);
  assert.deepEqual(none(agent({ diverted: true })), []);
  assert.deepEqual(none(agent({ activeFactors: [] })), []);
  assert.deepEqual(none(agent({ activeFactors: [{ id: 'w', factor: 'HEADWIND', value: 0.3 }] })), []);
  assert.deepEqual(stormRegions([flight], {}), []);
});
