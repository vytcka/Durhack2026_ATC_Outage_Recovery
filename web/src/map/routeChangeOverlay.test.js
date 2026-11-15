import test from 'node:test';
import assert from 'node:assert/strict';
import { endAngle, routeChangeEmphasis, routeChangeGeometry } from './routeChangeOverlay.js';
import { routePose } from '../simulation/routeGeometry.js';

const flight = { airport_dest: 'BBB', curve: [[0, 0], [50, -40], [100, 0]] };
const project = ([lon, lat]) => [lon * 2, lat * 2];
const diverted = (overrides = {}) => ({
  id: 'aircraft:0', phase: 'EN_ROUTE', diverted: true, arrivalAirport: 'CCC', progress: 0.5,
  diversion: { mode: 'direct', airport: 'CCC', previousAirport: 'BBB', trigger: 'DESTCLOSED',
    action: 'LANDNEARESTAIRPORT', startedAt: 2000, startProgress: 0.4, reroute: null, destination: [10, 30] },
  ...overrides,
});

test('diversion: dashed straight line to the abandoned airport and solid straight line to the new one, both from the plane', () => {
  const agent = diverted();
  const result = routeChangeGeometry(flight, agent, { project });
  const turn = routePose(flight.curve, 0.4).position;
  const to = [20, 60];
  const current = [turn[0] + (to[0] - turn[0]) * 0.5, turn[1] + (to[1] - turn[1]) * 0.5];
  assert.equal(result.type, 'diversion');
  assert.equal(result.changedAt, 2000);
  assert.deepEqual(result.turn, turn);
  assert.deepEqual(result.from, current);
  assert.deepEqual(result.oldDestination, flight.curve[2]);
  assert.deepEqual(result.newDestination, to);
  assert.equal(result.oldPath, `M${current} L${flight.curve[2]}`);
  assert.equal(result.newPath, `M${current} L${to}`);
  assert.equal(result.previousAirport, 'BBB');
  assert.equal(result.newAirport, 'CCC');
  assert.equal(result.trigger, 'DESTCLOSED');
  assert.equal(result.arrowAngle, endAngle(current, to));
});

test('diversion lines follow the plane as it flies the leg', () => {
  const early = routeChangeGeometry(flight, diverted({ progress: 0.1 }), { project });
  const late = routeChangeGeometry(flight, diverted({ progress: 0.9 }), { project });
  assert.notDeepEqual(early.from, late.from);
  assert.ok(early.newPath.startsWith(`M${early.from}`));
  assert.ok(late.oldPath.startsWith(`M${late.from}`));
});

test('diversion from a detour turns on the detoured curve', () => {
  const reroute = { approvedAt: 1000, startProgress: 0.2, endProgress: 0.98, offset: 0.18 };
  const agent = diverted({ progress: 0, reroute, diversion: { ...diverted().diversion, reroute } });
  const result = routeChangeGeometry(flight, agent, { project });
  assert.deepEqual(result.turn, routePose(flight.curve, 0.4, reroute).position);
  assert.deepEqual(result.from, result.turn);
});

test('detour: dashed original plan and solid detour are both attached to the plane', () => {
  const reroute = { approvedAt: 1000, startProgress: 0.25, endProgress: 0.98, offset: 0.2, reason: 'NO_GO_REGION' };
  const result = routeChangeGeometry(flight, { phase: 'EN_ROUTE', progress: 0.5, reroute });
  assert.equal(result.type, 'reroute');
  assert.equal(result.changedAt, 1000);
  assert.deepEqual(result.from, routePose(flight.curve, 0.5, reroute).position);
  assert.deepEqual(result.turn, routePose(flight.curve, 0.25).position);
  // Plane → original route at the same progress → original remainder to the destination.
  assert.ok(result.oldPath.startsWith(`M${result.from} L${routePose(flight.curve, 0.5).position}`));
  assert.ok(result.oldPath.endsWith(`L${flight.curve[2]}`));
  assert.ok(result.newPath.startsWith(`M${result.from}`));
  assert.ok(result.newPath.endsWith(`L${flight.curve[2]}`));
  assert.deepEqual(result.newDestination, flight.curve[2]);
  assert.equal(typeof result.arrowAngle, 'number');
});

test('catalogue airport is the fallback when the diversion has no coordinates', () => {
  const agent = diverted({ arrivalAirport: 'ATL', diversion: { ...diverted().diversion, airport: 'ATL', destination: undefined } });
  const result = routeChangeGeometry(flight, agent, { project });
  assert.deepEqual(result.newDestination, project([-84.4281, 33.6367]));
});

test('missing changes and malformed geometry are ignored rather than emitting invalid SVG', () => {
  assert.equal(routeChangeGeometry(flight, {}), null);
  assert.equal(routeChangeGeometry(flight, null), null);
  assert.equal(routeChangeGeometry(null, { reroute: { startProgress: 0.2 } }), null);
  assert.equal(routeChangeGeometry(flight, { reroute: { startProgress: NaN } }), null);
  assert.equal(routeChangeGeometry(flight, diverted()), null, 'no projection, no leg');
  assert.equal(routeChangeGeometry({ curve: [[0, 0], [1, NaN], [2, 0]] }, diverted(), { project }), null);
});

test('emphasis follows completed simulation time only, including rewind and pause', () => {
  const changedAt = 10_000;
  assert.equal(routeChangeEmphasis(changedAt - 1, changedAt), 0);
  assert.equal(routeChangeEmphasis(changedAt, changedAt), 1);
  assert.equal(routeChangeEmphasis(changedAt + 90_000, changedAt), 0.5);
  assert.equal(routeChangeEmphasis(changedAt + 200_000, changedAt), 0);
  assert.equal(routeChangeEmphasis(changedAt, null), 0);
});
