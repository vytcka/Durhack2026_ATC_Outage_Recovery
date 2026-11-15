import test from 'node:test';
import assert from 'node:assert/strict';
import { displayPose, diversionLeg, flownTrackPath } from './flightGeometry.js';
import { routePose } from '../simulation/routeGeometry.js';

const flight = { curve: [[0, 0], [50, -40], [100, 0]] };
const project = ([lon, lat]) => [lon, lat];
const diversion = { mode: 'direct', airport: 'CCC', previousAirport: 'BBB', startProgress: 0.4,
  startedAt: 1000, reroute: null, destination: [0, 50] };

test('undiverted aircraft follow the curve, including an approved detour', () => {
  const reroute = { startProgress: 0.2, endProgress: 0.98, offset: 0.18 };
  assert.deepEqual(displayPose(flight, { progress: 0.3 }, project), routePose(flight.curve, 0.3));
  assert.deepEqual(displayPose(flight, { progress: 0.5, reroute }, project), routePose(flight.curve, 0.5, reroute));
  assert.deepEqual(displayPose(flight, undefined, project), routePose(flight.curve, 0));
});

test('a diverted aircraft is continuous at the turn and flies straight to the new airport', () => {
  const before = displayPose(flight, { progress: 0.4 }, project);
  const atTurn = displayPose(flight, { diverted: true, progress: 0, diversion }, project);
  assert.deepEqual(atTurn.position, before.position);
  const landed = displayPose(flight, { diverted: true, progress: 1, diversion }, project);
  assert.deepEqual(landed.position, [0, 50]);
  const leg = diversionLeg(flight, { diverted: true, diversion }, project);
  const half = displayPose(flight, { diverted: true, progress: 0.5, diversion }, project);
  const expected = [(leg.turn[0] + 0) / 2, (leg.turn[1] + 50) / 2];
  assert.ok(half.position.every((value, index) => Math.abs(value - expected[index]) < 1e-9));
  // Heading points from the turn towards the new airport (down-left on screen: between 180° and 270°).
  const heading = ((half.heading % 360) + 360) % 360;
  assert.ok(heading > 180 && heading < 270, `heading ${heading}`);
  assert.equal(half.heading, atTurn.heading, 'constant heading along a straight leg');
});

test('flown track runs from the origin to the plane, through the turn point when diverted', () => {
  assert.equal(flownTrackPath(flight, { departedAt: null, progress: 0 }, project), null);
  const normal = flownTrackPath(flight, { departedAt: 0, progress: 0.5 }, project);
  assert.ok(normal.startsWith(`M${flight.curve[0]}`));
  assert.ok(normal.endsWith(`L${routePose(flight.curve, 0.5).position}`));
  const agent = { departedAt: 0, diverted: true, progress: 0.5, diversion };
  const track = flownTrackPath(flight, agent, project);
  const leg = diversionLeg(flight, agent, project);
  assert.ok(track.includes(`L${leg.turn}`));
  assert.ok(track.endsWith(`L${displayPose(flight, agent, project).position}`));
});
