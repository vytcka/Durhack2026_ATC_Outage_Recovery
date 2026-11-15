import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRadioNetwork, createRadio, distanceNm, radioHops } from './radio.js';

// One degree of latitude is 60 nm, so positions along a meridian make distances easy to read.
const at = (nm) => [-90, 30 + nm / 60];
const plane = (id, nm, airborne = true) => ({ id, position: at(nm), airborne });
const RANGES = { aircraftRangeNm: 100, towerRangeNm: 150 };
const radio = createRadio([{ id: 'atc:AAA', position: at(0) }], RANGES);

test('distance along a meridian is 60 nm per degree', () => {
  assert.ok(Math.abs(distanceNm(at(0), at(150)) - 150) < 1e-9);
});

test('an aircraft within tower range links to it directly', () => {
  const network = buildRadioNetwork([plane('aircraft:0', 149)], radio);
  assert.deepEqual(network.paths.get('aircraft:0'), ['aircraft:0', 'atc:AAA']);
  assert.deepEqual(radioHops(network, 'aircraft:0', 'atc:ZZZ'), [['aircraft:0', 'atc:AAA']]);
  assert.deepEqual(radioHops(network, 'atc:ZZZ', 'aircraft:0'), [['atc:AAA', 'aircraft:0']]);
});

test('out of tower range, an aircraft relays through the nearest linked aircraft', () => {
  const network = buildRadioNetwork([plane('aircraft:0', 140), plane('aircraft:1', 230)], radio);
  assert.deepEqual(network.paths.get('aircraft:1'), ['aircraft:1', 'aircraft:0', 'atc:AAA']);
  assert.deepEqual(radioHops(network, 'aircraft:1', 'atc:AAA'),
    [['aircraft:1', 'aircraft:0'], ['aircraft:0', 'atc:AAA']]);
});

test('relays chain, but only through airborne aircraft', () => {
  const chain = [plane('aircraft:0', 140), plane('aircraft:1', 230), plane('aircraft:2', 320)];
  assert.deepEqual(buildRadioNetwork(chain, radio).paths.get('aircraft:2'),
    ['aircraft:2', 'aircraft:1', 'aircraft:0', 'atc:AAA']);

  const grounded = [plane('aircraft:0', 140, false), plane('aircraft:1', 230)];
  assert.equal(buildRadioNetwork(grounded, radio).paths.get('aircraft:1'), undefined);
});

test('with nobody in range there is no radio path and messages are lost', () => {
  const network = buildRadioNetwork([plane('aircraft:0', 400)], radio);
  assert.equal(network.paths.get('aircraft:0'), undefined);
  assert.equal(radioHops(network, 'aircraft:0', 'atc:AAA'), null);
  assert.equal(radioHops(network, 'atc:AAA', 'aircraft:0'), null);
});

test('an aircraft keeps its current tower while in range, then hands over', () => {
  const two = createRadio([{ id: 'atc:AAA', position: at(0) }, { id: 'atc:BBB', position: at(200) }], RANGES);
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
  const network = buildRadioNetwork([plane('aircraft:0', 0), plane('aircraft:1', 99), plane('aircraft:2', 250)], radio);
  assert.deepEqual(radioHops(network, 'aircraft:0', 'aircraft:1'), [['aircraft:0', 'aircraft:1']]);
  assert.equal(radioHops(network, 'aircraft:0', 'aircraft:2'), null);
  assert.deepEqual(radioHops(network, 'atc:AAA', 'atc:BBB'), []);
});

test('the configured ranges are what decides coverage', () => {
  const short = createRadio([{ id: 'atc:AAA', position: at(0) }], { aircraftRangeNm: 10, towerRangeNm: 20 });
  // 15 nm from the tower: direct. 24 nm: out of tower range, but 9 nm from aircraft:0.
  // 40 nm: 16 nm from the nearest plane, too far for a 10 nm aircraft radio.
  const network = buildRadioNetwork([plane('aircraft:0', 15), plane('aircraft:1', 24), plane('aircraft:2', 40)], short);
  assert.deepEqual(network.paths.get('aircraft:0'), ['aircraft:0', 'atc:AAA']);
  assert.deepEqual(network.paths.get('aircraft:1'), ['aircraft:1', 'aircraft:0', 'atc:AAA']);
  assert.equal(network.paths.get('aircraft:2'), undefined);
});

test('ranges must be positive', () => {
  assert.throws(() => createRadio([], { aircraftRangeNm: 0 }), /positive/);
});
