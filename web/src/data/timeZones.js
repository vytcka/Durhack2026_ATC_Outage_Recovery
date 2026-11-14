// Time zone lookup for a point on the map.
//
// Real time zone boundaries are irregular (they follow county lines), so instead of shipping
// boundary polygons we approximate: find the airport closest to the point and use that
// airport's zone. With ~100 airports spread across every state this is accurate enough for
// a "what time is it where I'm looking" readout.
import { geoDistance } from 'd3-geo';
import { AIRPORTS } from './airports.js';

// Primary IANA zone per contiguous state (plus DC).
const STATE_TIME_ZONES = {
  AL: 'America/Chicago',  AR: 'America/Chicago',  AZ: 'America/Phoenix',  CA: 'America/Los_Angeles',
  CO: 'America/Denver',   CT: 'America/New_York', DC: 'America/New_York', DE: 'America/New_York',
  FL: 'America/New_York', GA: 'America/New_York', IA: 'America/Chicago',  ID: 'America/Boise',
  IL: 'America/Chicago',  IN: 'America/Indiana/Indianapolis',             KS: 'America/Chicago',
  KY: 'America/New_York', LA: 'America/Chicago',  MA: 'America/New_York', MD: 'America/New_York',
  ME: 'America/New_York', MI: 'America/Detroit',  MN: 'America/Chicago',  MO: 'America/Chicago',
  MS: 'America/Chicago',  MT: 'America/Denver',   NC: 'America/New_York', ND: 'America/Chicago',
  NE: 'America/Chicago',  NH: 'America/New_York', NJ: 'America/New_York', NM: 'America/Denver',
  NV: 'America/Los_Angeles', NY: 'America/New_York', OH: 'America/New_York', OK: 'America/Chicago',
  OR: 'America/Los_Angeles', PA: 'America/New_York', RI: 'America/New_York', SC: 'America/New_York',
  SD: 'America/Chicago',  TN: 'America/Chicago',  TX: 'America/Chicago',  UT: 'America/Denver',
  VA: 'America/New_York', VT: 'America/New_York', WA: 'America/Los_Angeles', WI: 'America/Chicago',
  WV: 'America/New_York', WY: 'America/Denver',
};

// Airports in the part of a split state that doesn't follow the state's primary zone.
const AIRPORT_TIME_ZONES = {
  ELP: 'America/Denver',  // far west Texas is on Mountain time
  PNS: 'America/Chicago', // Florida panhandle is on Central time
  RAP: 'America/Denver',  // western South Dakota is on Mountain time
};

const DEFAULT_TIME_ZONE = 'America/Chicago';

// `city` is formatted "City, ST", so the state code is the last two characters.
const stateOf = (airport) => airport.city.slice(-2);

export function timeZoneOf(airport) {
  return AIRPORT_TIME_ZONES[airport.iata] ?? STATE_TIME_ZONES[stateOf(airport)] ?? DEFAULT_TIME_ZONE;
}

export function nearestAirport([lon, lat]) {
  let nearest = null;
  let minDistance = Infinity;

  for (const airport of AIRPORTS) {
    const distance = geoDistance([lon, lat], [airport.lon, airport.lat]);
    if (distance < minDistance) {
      minDistance = distance;
      nearest = airport;
    }
  }
  return nearest;
}

export function timeZoneAt(lonLat) {
  if (!lonLat || lonLat.some(Number.isNaN)) return DEFAULT_TIME_ZONE;
  return timeZoneOf(nearestAirport(lonLat));
}
