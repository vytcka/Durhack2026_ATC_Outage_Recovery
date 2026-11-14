// Everything geographic: the projection and the pre-built SVG path strings.
import { geoConicConformal, geoPath, geoGraticule, geoCircle } from 'd3-geo';
import { feature, mesh } from 'topojson-client';
import usAtlas from 'us-atlas/states-10m.json'; // US Census 1:10m boundaries
import { AIRPORTS } from '../data/airports.js';

// Fixed drawing size (SVG viewBox units). The SVG scales to fit the screen.
export const WIDTH = 1600;
export const HEIGHT = 1000;

// Lower 48 only: drop Alaska, Hawaii and territories (FIPS codes).
const NOT_CONTIGUOUS = ['02', '15', '60', '66', '69', '72', '78'];
const statesObject = {
  ...usAtlas.objects.states,
  geometries: usAtlas.objects.states.geometries.filter((s) => !NOT_CONTIGUOUS.includes(s.id)),
};
const states = feature(usAtlas, statesObject);

// Lambert Conformal Conic: the projection used on FAA aeronautical charts.
export const projection = geoConicConformal()
  .parallels([33, 45])
  .rotate([96, 0])
  .fitExtent([[80, 60], [WIDTH - 80, HEIGHT - 60]], states);

const path = geoPath(projection);

// 1 nautical mile = 1 arc-minute of latitude.
const nmToDegrees = (nm) => nm / 60;
const ring = (airport, nm) =>
  path(geoCircle().center([airport.lon, airport.lat]).radius(nmToDegrees(nm))());

export const paths = {
  graticule: path(geoGraticule().extent([[-135, 20], [-60, 55]]).step([5, 5])()),
  land: path(states),
  stateBorders: path(mesh(usAtlas, statesObject, (a, b) => a !== b)),
  coastline: path(mesh(usAtlas, statesObject, (a, b) => a === b)),
  outerRings: AIRPORTS.map((a) => ring(a, 30)).join(''),
  innerRings: AIRPORTS.map((a) => ring(a, 10)).join(''),
};
