import test from 'node:test';
import assert from 'node:assert/strict';
import { aircraftLabel, diversionReason, policyLabel, shortDelay } from './flightText.js';

const flight = { flight_number: '5X948' };

test('labels add the delay for late flights and the new airport while diverting', () => {
  assert.equal(aircraftLabel(flight, { phase: 'EN_ROUTE', delayed: false }), '5X948');
  assert.equal(aircraftLabel(flight, { phase: 'EN_ROUTE', delayed: true, totalDelayMs: 12 * 60_000 + 5_000 }), '5X948 +12m');
  assert.equal(aircraftLabel(flight, { phase: 'EN_ROUTE', delayed: true, totalDelayMs: 30_000 }), '5X948');
  assert.equal(aircraftLabel(flight, { phase: 'EN_ROUTE', diverted: true, arrivalAirport: 'IND', totalDelayMs: 0 }), '5X948 → IND');
  assert.equal(aircraftLabel(flight, { phase: 'ARRIVED', delayed: true, totalDelayMs: 3 * 60_000 }), '5X948 +3m');
});

test('reasons and policies have readable text', () => {
  assert.equal(diversionReason({ trigger: 'DESTCLOSED' }), 'destination closed');
  assert.equal(diversionReason({ trigger: 'COMLOST' }), 'lost contact with destination ATC');
  assert.equal(diversionReason({ trigger: 'LOWRESERVE' }), 'low reserve');
  assert.equal(diversionReason(null), 'alternate requested');
  assert.equal(policyLabel('LANDNEARESTAIRPORT'), 'Nearest open airport');
  assert.equal(shortDelay(null), null);
});
