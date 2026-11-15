import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compactDelay, describeFlight, describeFlights, diversionTitle, filterCounts, filterRows,
  progressText, sortRows, summariseStatuses, SUMMARY_STATUS_IDS, TRACKER_FILTERS,
} from './flightTracker.js';
import { FLIGHT_STATUS_BY_ID } from './flightStatus.js';

const flight = (agentId, flightNumber, dep = 'SDF', dest = 'DEN') =>
  ({ agentId, flight_number: flightNumber, airport_dep: dep, airport_dest: dest });
const agent = overrides => ({
  phase: 'EN_ROUTE', progress: 0.45, delayed: false, diverted: false, reroute: null, diversion: null,
  totalDelayMs: 0, departureDelayMs: 0, travelDelayMs: 0, arrivalDelayMs: 0, arrivedAt: null,
  arrivalAirport: 'DEN', ...overrides,
});
const diversion = { mode: 'direct', airport: 'IND', previousAirport: 'DEN', trigger: 'DESTCLOSED',
  action: 'LANDNEARESTAIRPORT', startedAt: 1_800_000 };

test('compact delays use the largest sensible unit', () => {
  assert.equal(compactDelay(0), null);
  assert.equal(compactDelay(undefined), null);
  assert.equal(compactDelay(-5), null);
  assert.equal(compactDelay(500), '+1s');
  assert.equal(compactDelay(45_000), '+45s');
  assert.equal(compactDelay(12 * 60_000 + 30_000), '+12m');
  assert.equal(compactDelay(75 * 60_000), '+1h 15m');
});

test('progress text follows the phase, the diversion leg and the landing time', () => {
  assert.equal(progressText(undefined), 'Awaiting departure');
  assert.equal(progressText(agent({ phase: 'REQUESTING_DEPARTURE' })), 'Awaiting departure');
  assert.equal(progressText(agent()), 'En route 45%');
  assert.equal(progressText(agent({ diverted: true, progress: 0.3 })), 'Diversion leg 30%');
  assert.equal(progressText(agent({ phase: 'AWAITING_ARRIVAL' })), 'Awaiting landing approval');
  assert.equal(progressText(agent({ phase: 'ARRIVED', arrivedAt: 9_060_000 })), 'Landed 02:31');
  assert.equal(progressText(agent({ progress: 1.4 })), 'En route 100%');
});

test('a diverted row strikes the old destination and explains why', () => {
  const row = describeFlight(flight('aircraft:0', '5X948'), agent({
    diverted: true, progress: 0.3, arrivalAirport: 'IND', diversion, delayed: true, totalDelayMs: 4 * 60_000,
    travelDelayMs: 4 * 60_000,
  }));
  assert.equal(row.status, 'diverting');
  assert.equal(row.origin, 'SDF');
  assert.equal(row.previousDestination, 'DEN');
  assert.equal(row.destination, 'IND');
  assert.equal(row.diversionTitle, 'Destination closed: DEN → IND (nearest open airport)');
  assert.equal(row.detail, 'Destination closed');
  assert.equal(row.progress, 'Diversion leg 30%');
  assert.equal(row.delay, '+4m');
  assert.match(row.delayTitle, /Total delay 4m 00s/);
  assert.match(row.ariaLabel, /SDF to IND, diverted from DEN/);
  assert.equal(row.disrupted, true);
});

test('diversion fallbacks: missing previous airport and other triggers/actions', () => {
  const row = describeFlight(flight('aircraft:1', 'AA1', 'BOS', 'ORD'), agent({
    diverted: true, arrivalAirport: 'BOS', diversion: { airport: 'BOS', trigger: 'COMLOST', action: 'RETURNTOORIGIN' },
  }));
  assert.equal(row.previousDestination, 'ORD');
  assert.equal(row.destination, 'BOS');
  assert.equal(row.detail, 'Lost contact');
  assert.equal(row.diversionTitle, 'Lost contact with destination ATC: ORD → BOS (return to origin)');
  assert.equal(diversionTitle(null, 'ORD', 'MDW'), 'Diverted: ORD → MDW');
  const landed = describeFlight(flight('aircraft:1', 'AA1', 'BOS', 'ORD'), agent({
    phase: 'ARRIVED', arrivedAt: 3_600_000, diverted: true, arrivalAirport: 'BOS', diversion: { airport: 'BOS', trigger: 'LOWRESERVE' },
  }));
  assert.equal(landed.status, 'diverted-landed');
  assert.equal(landed.detail, 'Low reserve');
  assert.equal(landed.progress, 'Landed 01:00');
  assert.equal(landed.landed, true);
});

test('detour, delayed and on-time rows describe their state', () => {
  const detour = describeFlight(flight('aircraft:2', 'DL2'), agent({ reroute: { reason: 'NO_GO_REGION', approvedAt: 0 } }));
  assert.equal(detour.status, 'detouring');
  assert.equal(detour.detail, 'Detour · no-go region');
  assert.equal(detour.previousDestination, null);
  const late = describeFlight(flight('aircraft:3', 'UA3'), agent({ delayed: true, totalDelayMs: 120_000, departureDelayMs: 120_000 }));
  assert.equal(late.status, 'delayed');
  assert.equal(late.detail, 'Delayed · late departure');
  const landedLate = describeFlight(flight('aircraft:4', 'UA4'), agent({ phase: 'ARRIVED', arrivedAt: 60_000,
    delayed: true, totalDelayMs: 90_000, travelDelayMs: 30_000, arrivalDelayMs: 60_000 }));
  assert.equal(landedLate.status, 'landed-late');
  assert.equal(landedLate.detail, 'Late · landing hold');
  const onTime = describeFlight(flight('aircraft:5', 'WN5'), agent());
  assert.equal(onTime.detail, null);
  assert.equal(onTime.delay, null);
  assert.equal(onTime.disrupted, false);
  assert.equal(describeFlight(flight('aircraft:6', 'WN6'), undefined).status, 'scheduled');
});

test('signatures change only when displayed content changes', () => {
  const base = describeFlight(flight('aircraft:0', 'X1'), agent());
  assert.equal(describeFlight(flight('aircraft:0', 'X1'), agent({ position: [1, 2] })).signature, base.signature);
  assert.notEqual(describeFlight(flight('aircraft:0', 'X1'), agent({ progress: 0.5 })).signature, base.signature);
  assert.notEqual(describeFlight(flight('aircraft:0', 'X1'), agent({ delayed: true, totalDelayMs: 10_000 })).signature, base.signature);
});

const fleet = () => {
  const flights = [
    flight('aircraft:0', 'B200'), flight('aircraft:1', 'A100'), flight('aircraft:2', 'C300'),
    flight('aircraft:3', 'D400'), flight('aircraft:4', 'E500'), flight('aircraft:5', 'F600'),
    flight('aircraft:6', 'G700'), flight('aircraft:7', 'H800'), flight('aircraft:8', 'A050'),
  ];
  const agents = {
    'aircraft:0': agent({ delayed: true, totalDelayMs: 60_000 }),
    'aircraft:1': agent(),
    'aircraft:2': agent({ delayed: true, totalDelayMs: 300_000 }),
    'aircraft:3': agent({ diverted: true, arrivalAirport: 'IND', diversion }),
    'aircraft:4': agent({ reroute: { reason: 'NO_GO_REGION' }, delayed: true, totalDelayMs: 30_000 }),
    'aircraft:5': agent({ phase: 'ARRIVED', arrivedAt: 600_000 }),
    'aircraft:6': agent({ phase: 'ARRIVED', arrivedAt: 600_000, delayed: true, totalDelayMs: 50_000 }),
    'aircraft:7': agent({ phase: 'ARRIVED', arrivedAt: 600_000, diverted: true, diversion, totalDelayMs: 0 }),
    'aircraft:8': agent(),
  };
  return describeFlights(flights, agents);
};

test('sorting puts route changes first, then delays worst-first, then everything else by flight number', () => {
  assert.deepEqual(sortRows(fleet()).map(row => row.flightNumber),
    ['D400', 'E500', 'C300', 'B200', 'G700', 'H800', 'A050', 'A100', 'F600']);
});

test('sorting does not mutate its input', () => {
  const rows = fleet();
  const before = rows.map(row => row.id);
  sortRows(rows);
  assert.deepEqual(rows.map(row => row.id), before);
});

test('filters and counts agree with the status table', () => {
  const rows = fleet();
  assert.deepEqual(filterRows(rows, 'disrupted').map(row => row.flightNumber).sort(),
    ['B200', 'C300', 'D400', 'E500', 'G700', 'H800']);
  assert.equal(filterRows(rows, 'all').length, rows.length);
  assert.deepEqual(filterRows(rows, 'delayed').map(row => row.flightNumber).sort(), ['B200', 'C300', 'E500', 'G700']);
  assert.deepEqual(filterRows(rows, 'diverted').map(row => row.flightNumber).sort(), ['D400', 'H800']);
  assert.deepEqual(filterRows(rows, 'detours').map(row => row.flightNumber), ['E500']);
  assert.equal(filterRows(rows, 'unknown').length, rows.length);
  assert.deepEqual(filterCounts(rows), { disrupted: 6, all: 9, delayed: 4, diverted: 2, detours: 1 });
  assert.deepEqual(Object.keys(filterCounts(rows)), TRACKER_FILTERS.map(filter => filter.id));
  const counts = summariseStatuses(rows);
  assert.deepEqual(counts, { scheduled: 0, 'on-time': 2, delayed: 2, detouring: 1, diverting: 1,
    landed: 1, 'landed-late': 1, 'diverted-landed': 1 });
  assert.ok(SUMMARY_STATUS_IDS.every(id => FLIGHT_STATUS_BY_ID[id]));
});
