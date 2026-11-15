import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { AIRPORT_BY_IATA } from '../data/airports.js';
import { Simulation } from './engine.js';

const flights = JSON.parse(readFileSync(new URL('../../public/aircraft_info.json', import.meta.url), 'utf8'))
  .filter(flight => AIRPORT_BY_IATA[flight.airport_dep] && AIRPORT_BY_IATA[flight.airport_dest]);
const scenarios = [
  ['healthy', []],
  ['30-minute ATC outage', [{ factor: 'ATC_LINK_OUTAGE', startMs: 0, endMs: 1_800_000 }]],
  ['100% loss all day', [{ factor: 'PACKET_LOSS', startMs: 0, endMs: 86_400_000, value: 1 }]],
  ['50% travel speed', [{ factor: 'REDUCED_SPEED', startMs: 0, endMs: 86_400_000, value: 0.5 }]],
];
for (const limit of [50, 100]) {
  for (const [name, disruptions] of scenarios) {
    const start = performance.now();
    const simulation = new Simulation(flights.slice(0, limit), { disruptions, seed: 42 });
    const snapshot = simulation.advanceTo(86_399_999);
    console.log(JSON.stringify({
      scenario: name, aircraft: snapshot.aircraft.length, atc: snapshot.stats.atcAgents,
      simulatedHours: 24, computeMs: Number((performance.now() - start).toFixed(1)),
      arrived: snapshot.stats.arrived, dropped: snapshot.stats.dropped,
      disruptedFlights: snapshot.stats.disruptedFlights, lateArrivals: snapshot.stats.delayedArrivals,
      totalDelayMs: snapshot.stats.totalDelayMs,
      queued: snapshot.stats.queued, retainedEvents: snapshot.events.length,
      heapUsedMB: Number((process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1)),
    }));
  }
}
