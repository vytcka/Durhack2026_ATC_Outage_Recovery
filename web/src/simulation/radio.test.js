import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRadioNetwork, createTowers, distanceNm, radioHops } from './radio.js';

// One degree of latitude is 60 nm, so positions along a meridian make distances easy to read.
const at = (nm) => [-90, 30 + nm / 60];
const towers = createTowers([{ id: 'atc:AAA', position: at(0) }]);
const plane = (id, nm, airborne = true) => ({ id, position: at(nm), airborne });

test('distance along a meridian is 60 nm per degree', () => {
  assert.ok(Math.abs(distanceNm(at(0), at(150)) - 150) < 1e-9);
});

test('an aircraft within 150 nm of a tower links to it directly', () => {
  const network = buildRadioNetwork([plane('aircraft:0', 149)], towers);
  assert.deepEqual(network.paths.get('aircraft:0'), ['aircraft:0', 'atc:AAA']);
  assert.deepEqual(radioHops(network, 'aircraft:0', 'atc:ZZZ'), [['aircraft:0', 'atc:AAA']]);
  assert.deepEqual(radioHops(network, 'atc:ZZZ', 'aircraft:0'), [['atc:AAA', 'aircraft:0']]);
});

test('out of tower range, an aircraft relays through the nearest linked aircraft', () => {
  const network = buildRadioNetwork([plane('aircraft:0', 140), plane('aircraft:1', 230)], towers);
  assert.deepEqual(network.paths.get('aircraft:1'), ['aircraft:1', 'aircraft:0', 'atc:AAA']);
  assert.deepEqual(radioHops(network, 'aircraft:1', 'atc:AAA'),
    [['aircraft:1', 'aircraft:0'], ['aircraft:0', 'atc:AAA']]);
});

test('relays chain, but only through airborne aircraft', () => {
  const chain = [plane('aircraft:0', 140), plane('aircraft:1', 230), plane('aircraft:2', 320)];
  assert.deepEqual(buildRadioNetwork(chain, towers).paths.get('aircraft:2'),
    ['aircraft:2', 'aircraft:1', 'aircraft:0', 'atc:AAA']);

  const grounded = [plane('aircraft:0', 140, false), plane('aircraft:1', 230)];
  assert.equal(buildRadioNetwork(grounded, towers).paths.get('aircraft:1'), undefined);
});

test('with nobody in range there is no radio path and messages are lost', () => {
  const network = buildRadioNetwork([plane('aircraft:0', 400)], towers);
  assert.equal(network.paths.get('aircraft:0'), undefined);
  assert.equal(radioHops(network, 'aircraft:0', 'atc:AAA'), null);
  assert.equal(radioHops(network, 'atc:AAA', 'aircraft:0'), null);
});

test('an aircraft keeps its current tower while in range, then hands over', () => {
  const two = createTowers([{ id: 'atc:AAA', position: at(0) }, { id: 'atc:BBB', position: at(200) }]);
  let network = buildRadioNetwork([plane('aircraft:0', 90)], two);
  assert.equal(network.paths.get('aircraft:0').at(-1), 'atc:AAA');

  // BBB is now nearer, but AAA is still in range: no switch.
  network = buildRadioNetwork([plane('aircraft:0', 120)], two, network);
  assert.equal(network.paths.get('aircraft:0').at(-1), 'atc:AAA');

  // Past AAA's range: hand over to BBB.
  network = buildRadioNetwork([plane('aircraft:0', 160)], two, network);
  assert.equal(network.paths.get('aircraft:0').at(-1), 'atc:BBB');
});

test('aircraft-to-aircraft messages need direct range; tower-to-tower uses the ground line', () => {
  const network = buildRadioNetwork([plane('aircraft:0', 0), plane('aircraft:1', 99), plane('aircraft:2', 250)], towers);
  assert.deepEqual(radioHops(network, 'aircraft:0', 'aircraft:1'), [['aircraft:0', 'aircraft:1']]);
  assert.equal(radioHops(network, 'aircraft:0', 'aircraft:2'), null);
  assert.deepEqual(radioHops(network, 'atc:AAA', 'atc:BBB'), []);
});
