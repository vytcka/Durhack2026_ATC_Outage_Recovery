// Radio coverage: who can physically talk to whom.
//
// - A tower (the ATC at an airport) reaches aircraft within `towerRangeNm`.
// - Aircraft reach each other within `aircraftRangeNm`.
// - Towers are joined by ground lines, so a message that reaches any tower can get to the ATC
//   it is addressed to, wherever that is.
//
// Each aircraft has at most one uplink towards the ground:
//   1. its current tower, while still in range (no flip-flopping at the edge of coverage),
//   2. otherwise the nearest tower in range,
//   3. otherwise the nearest airborne aircraft that has an uplink itself (a relay; relays chain).
// No uplink means no radio: every message to or from that aircraft is lost.
//
// Cost: links are rebuilt once per engine step. Nodes are bucketed in a coarse lon/lat grid, so
// finding "the nearest node in range" only looks at the 3×3 cells around a position instead of
// every node on the map.

export const DEFAULT_RANGES = { aircraftRangeNm: 100, towerRangeNm: 150 };

const NM_PER_DEGREE = 60;
// The grid must hold everything in range within one cell. A degree of longitude is shortest at
// the northern edge of the contiguous US, ~50°N, so size the cells for that latitude.
const NM_PER_DEGREE_LON_AT_50N = NM_PER_DEGREE * Math.cos(50 * Math.PI / 180);

// Flat-earth approximation, plenty accurate over a few hundred miles.
export function distanceNm([lon1, lat1], [lon2, lat2]) {
  const x = (lon2 - lon1) * Math.cos(((lat1 + lat2) / 2) * Math.PI / 180);
  return Math.hypot(x, lat2 - lat1) * NM_PER_DEGREE;
}

// nodes: [{ id, position: [lon, lat] }] -> { cellDegrees, cells: Map "x:y" -> nodes in that cell }
function buildGrid(nodes, cellDegrees) {
  const cells = new Map();
  for (const node of nodes) {
    const key = cellKey(node.position, cellDegrees, 0, 0);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(node);
  }
  return { cellDegrees, cells };
}

function cellKey([lon, lat], cellDegrees, dx, dy) {
  return `${Math.floor(lon / cellDegrees) + dx}:${Math.floor(lat / cellDegrees) + dy}`;
}

function nearestInRange(grid, position, rangeNm) {
  let nearest = null;
  let nearestDistance = Infinity;

  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (const node of grid.cells.get(cellKey(position, grid.cellDegrees, dx, dy)) ?? []) {
        const distance = distanceNm(position, node.position);
        if (distance <= rangeNm && distance < nearestDistance) {
          nearest = node;
          nearestDistance = distance;
        }
      }
    }
  }
  return nearest;
}

// Set up once per simulation: ranges plus the towers' grid (towers don't move).
// towers: [{ id: 'atc:ATL', position: [lon, lat] }]
export function createRadio(towers, ranges = {}) {
  const { aircraftRangeNm, towerRangeNm } = { ...DEFAULT_RANGES, ...ranges };
  for (const range of [aircraftRangeNm, towerRangeNm]) {
    if (!Number.isFinite(range) || range <= 0) throw new Error('Radio ranges must be positive numbers of nautical miles');
  }

  return {
    aircraftRangeNm,
    towerRangeNm,
    // Shorter ranges give smaller cells, so fewer nodes to compare against.
    aircraftCellDegrees: aircraftRangeNm / NM_PER_DEGREE_LON_AT_50N,
    towerPositions: new Map(towers.map(tower => [tower.id, tower.position])),
    towerGrid: buildGrid(towers, towerRangeNm / NM_PER_DEGREE_LON_AT_50N),
  };
}

// aircraft: [{ id, position: [lon, lat], airborne }]
// previous: the network from the last step (for keeping the current tower), or null.
// Returns { radio, paths, positions }, where paths maps an aircraft id to its route to the
// ground: [aircraft, tower] for a direct link, [aircraft, relay, ..., tower] through relays.
export function buildRadioNetwork(aircraft, radio, previous = null) {
  const paths = new Map();
  const positions = new Map(aircraft.map(plane => [plane.id, plane.position]));

  // 1. Direct tower links. Keep the current tower while it is still in range.
  for (const plane of aircraft) {
    const previousPath = previous?.paths.get(plane.id);
    const currentTower = previousPath?.length === 2 ? previousPath[1] : null;
    const currentPosition = currentTower && radio.towerPositions.get(currentTower);

    let tower = null;
    if (currentPosition && distanceNm(plane.position, currentPosition) <= radio.towerRangeNm) tower = currentTower;
    else tower = nearestInRange(radio.towerGrid, plane.position, radio.towerRangeNm)?.id ?? null;

    if (tower) paths.set(plane.id, [plane.id, tower]);
  }

  // 2. Relays, one ring at a time: aircraft within range of a linked aircraft link through it,
  //    then their neighbours link through them, and so on. Only airborne aircraft relay.
  let linked = aircraft.filter(plane => plane.airborne && paths.has(plane.id));
  let unlinked = aircraft.filter(plane => plane.airborne && !paths.has(plane.id));

  while (linked.length && unlinked.length) {
    const grid = buildGrid(linked, radio.aircraftCellDegrees);
    const newlyLinked = [];

    unlinked = unlinked.filter(plane => {
      const relay = nearestInRange(grid, plane.position, radio.aircraftRangeNm);
      if (!relay) return true;
      paths.set(plane.id, [plane.id, ...paths.get(relay.id)]);
      newlyLinked.push(plane);
      return false;
    });

    linked = newlyLinked;
  }

  return { radio, paths, positions };
}

// Radio hops a message makes right now, as [from, to] pairs:
//   []   tower to tower, ground line only;
//   null no radio path, so the message is lost.
// Aircraft-to-aircraft messages (peer reports, relay requests) need direct range.
export function radioHops(network, from, to) {
  const fromAircraft = from.startsWith('aircraft:');
  const toAircraft = to.startsWith('aircraft:');

  if (!fromAircraft && !toAircraft) return [];

  if (fromAircraft && toAircraft) {
    const a = network.positions.get(from);
    const b = network.positions.get(to);
    return a && b && distanceNm(a, b) <= network.radio.aircraftRangeNm ? [[from, to]] : null;
  }

  const plane = fromAircraft ? from : to;
  const path = network.paths.get(plane);
  if (!path) return null;

  // Uplink: aircraft -> relay -> ... -> tower. Downlink is the same chain the other way round.
  const uplink = path.slice(1).map((node, index) => [path[index], node]);
  return fromAircraft ? uplink : uplink.reverse().map(([a, b]) => [b, a]);
}
