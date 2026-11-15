// Radio coverage: who can physically talk to whom.
//
// - A tower (the ATC at an airport) reaches aircraft within TOWER_RANGE_NM.
// - Aircraft reach each other within AIRCRAFT_RANGE_NM.
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

export const AIRCRAFT_RANGE_NM = 100;
export const TOWER_RANGE_NM = 150;

const NM_PER_DEGREE = 60;
// Cell size in degrees. It must be at least the longest range in degrees of longitude, so
// anything in range is at most one cell away: 150 nm is ~3.9° of longitude at 50°N, the
// northern edge of the contiguous US.
const CELL_DEGREES = 4;

// Flat-earth approximation, plenty accurate over a few hundred miles.
export function distanceNm([lon1, lat1], [lon2, lat2]) {
  const x = (lon2 - lon1) * Math.cos(((lat1 + lat2) / 2) * Math.PI / 180);
  return Math.hypot(x, lat2 - lat1) * NM_PER_DEGREE;
}

const cellOf = ([lon, lat]) => [Math.floor(lon / CELL_DEGREES), Math.floor(lat / CELL_DEGREES)];

// nodes: [{ id, position: [lon, lat] }] -> Map "x:y" -> nodes in that cell
function buildGrid(nodes) {
  const grid = new Map();
  for (const node of nodes) {
    const [x, y] = cellOf(node.position);
    const key = `${x}:${y}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(node);
  }
  return grid;
}

function nearestInRange(grid, position, rangeNm) {
  const [cx, cy] = cellOf(position);
  let nearest = null;
  let nearestDistance = Infinity;

  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (const node of grid.get(`${cx + dx}:${cy + dy}`) ?? []) {
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

// Towers don't move, so their grid is built once per simulation.
// towers: [{ id: 'atc:ATL', position: [lon, lat] }]
export function createTowers(towers) {
  return {
    positions: new Map(towers.map(tower => [tower.id, tower.position])),
    grid: buildGrid(towers),
  };
}

// aircraft: [{ id, position: [lon, lat], airborne }]
// previous: the network from the last step (for keeping the current tower), or null.
// Returns { paths, positions }, where paths maps an aircraft id to its route to the ground:
// [aircraft, tower] for a direct link, [aircraft, relay, ..., tower] through relays.
export function buildRadioNetwork(aircraft, towers, previous = null) {
  const paths = new Map();
  const positions = new Map(aircraft.map(plane => [plane.id, plane.position]));

  // 1. Direct tower links. Keep the current tower while it is still in range.
  for (const plane of aircraft) {
    const previousPath = previous?.paths.get(plane.id);
    const currentTower = previousPath?.length === 2 ? previousPath[1] : null;
    const currentPosition = currentTower && towers.positions.get(currentTower);

    let tower = null;
    if (currentPosition && distanceNm(plane.position, currentPosition) <= TOWER_RANGE_NM) tower = currentTower;
    else tower = nearestInRange(towers.grid, plane.position, TOWER_RANGE_NM)?.id ?? null;

    if (tower) paths.set(plane.id, [plane.id, tower]);
  }

  // 2. Relays, one ring at a time: aircraft within range of a linked aircraft link through it,
  //    then their neighbours link through them, and so on. Only airborne aircraft relay.
  let linked = aircraft.filter(plane => plane.airborne && paths.has(plane.id));
  let unlinked = aircraft.filter(plane => plane.airborne && !paths.has(plane.id));

  while (linked.length && unlinked.length) {
    const grid = buildGrid(linked);
    const newlyLinked = [];

    unlinked = unlinked.filter(plane => {
      const relay = nearestInRange(grid, plane.position, AIRCRAFT_RANGE_NM);
      if (!relay) return true;
      paths.set(plane.id, [plane.id, ...paths.get(relay.id)]);
      newlyLinked.push(plane);
      return false;
    });

    linked = newlyLinked;
  }

  return { paths, positions };
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
    return a && b && distanceNm(a, b) <= AIRCRAFT_RANGE_NM ? [[from, to]] : null;
  }

  const plane = fromAircraft ? from : to;
  const path = network.paths.get(plane);
  if (!path) return null;

  // Uplink: aircraft -> relay -> ... -> tower. Downlink is the same chain the other way round.
  const uplink = path.slice(1).map((node, index) => [path[index], node]);
  return fromAircraft ? uplink : uplink.reverse().map(([a, b]) => [b, a]);
}
