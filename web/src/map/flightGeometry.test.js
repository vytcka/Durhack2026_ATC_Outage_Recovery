import test from 'node:test';
import assert from 'node:assert/strict';
import { arcLengthTable, curveParam, displayPose, diversionLeg, flownTrackPath } from './flightGeometry.js';
import { routePose } from '../simulation/routeGeometry.js';

const flight = { curve: [[0, 0], [50, -40], [100, 0]] };
// A prepared flight: arc-length table plus the record fields the physics speed profile reads.
const eased = { ...flight, arcLengths: arcLengthTable(flight.curve), est_flight_dur: 120, altitude: 350, airspeed: 480 };

test('with the physics speed profile, planes move by distance and a detour still starts at the plane', () => {
  // Climbing out, the plane has covered less of the route than of the flight time.
  assert.ok(curveParam(eased, 0.1) < 0.1);
  assert.equal(curveParam(eased, 0), 0);
  assert.equal(curveParam(eased, 1), 1);
  // The detour window is mapped into the same space, so approval causes no sideways jump...
  const reroute = { startProgress: 0.3, endProgress: 0.98, offset: 0.2 };
  assert.deepEqual(displayPose(eased, { progress: 0.3, reroute }).position, displayPose(eased, { progress: 0.3 }).position);
  // ...and the bypass is visible once the plane is under way on it.
  assert.notDeepEqual(displayPose(eased, { progress: 0.6, reroute }).position, displayPose(eased, { progress: 0.6 }).position);
});

test('a diversion from an eased route turns exactly where the plane was drawn', () => {
  const agent = { progress: 0.45 };
  const before = displayPose(eased, agent, project).position;
  const atTurn = displayPose(eased, { diverted: true, progress: 0, diversion: { ...diversion, startProgress: 0.45 } }, project).position;
  assert.deepEqual(atTurn, before);
});
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
