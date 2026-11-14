"""Build web/public/aircraft_info.json from an ADS-B snapshot (data/data.json).

The snapshot has no departure/destination, so each callsign's route is looked up on
adsbdb.com. Only flights where both ends are airports shown on the map are kept.
Route lookups are cached in data/routes_cache.json, so re-runs don't hit the API again.

Usage:  python matcher.py               # look up missing routes, then build the file
        python matcher.py --cache-only  # build from cached routes only, no network
"""
import argparse
import json
import math
import re
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent
SNAPSHOT_FILE = ROOT / "data" / "data.json"
CACHE_FILE = ROOT / "data" / "routes_cache.json"
AIRPORTS_FILE = ROOT.parent / "web" / "src" / "data" / "airports.js"
OUTPUT_FILE = ROOT.parent / "web" / "public" / "aircraft_info.json"

ROUTE_API = "https://api.adsbdb.com/v0/callsign/{}"
REQUEST_DELAY_S = 0.2  # be polite to a free API

# Rough bounding box of the contiguous US. Aircraft outside it can't be on a domestic route
# we draw, so we don't spend lookups on them.
US_BOUNDS = {"lat": (24.0, 50.0), "lon": (-125.0, -66.0)}

EARTH_RADIUS_NM = 3440.1
CRUISE_SPEED_KT = 450  # used for estimates when the snapshot caught a plane climbing/descending
TAXI_CLIMB_DESCENT_MIN = 25  # time on top of pure cruise distance / speed
RESERVE_FUEL_HOURS = 0.75    # regulatory-style reserve, roughly 45 minutes

# Typical fuel burn (kg/hour) by ADS-B emitter category. Only a ballpark, there's no fuel data
# in the feed. A1 light, A2 small, A3 large (737/A320), A4 B757, A5 heavy (widebodies).
FUEL_BURN_KG_PER_HOUR = {"A1": 60, "A2": 800, "A3": 2500, "A4": 3200, "A5": 6500}
DEFAULT_FUEL_BURN = 2500

EMERGENCY_SQUAWKS = {"7500": "MAYDAY", "7700": "MAYDAY", "7600": "PANPAN"}
EMERGENCY_FIELD = {"general": "MAYDAY", "unlawful": "MAYDAY", "downed": "MAYDAY",
                   "nordo": "PANPAN", "minfuel": "PANPAN", "lifeguard": "PANPAN"}


def load_map_airports():
    """Read {iata: (lat, lon)} straight from the frontend's airports.js, so both stay in sync."""
    source = AIRPORTS_FILE.read_text(encoding="utf-8")
    pattern = re.compile(r"iata: '([A-Z]{3})'.*?lat: (-?[\d.]+), lon: (-?[\d.]+)")
    return {iata: (float(lat), float(lon)) for iata, lat, lon in pattern.findall(source)}


def in_us(aircraft):
    lat, lon = aircraft.get("lat"), aircraft.get("lon")
    if lat is None or lon is None:
        return False
    return (US_BOUNDS["lat"][0] <= lat <= US_BOUNDS["lat"][1]
            and US_BOUNDS["lon"][0] <= lon <= US_BOUNDS["lon"][1])


def is_candidate(aircraft):
    """Airborne, has a callsign, and is over the contiguous US."""
    callsign = aircraft.get("flight", "").strip()
    airborne = isinstance(aircraft.get("alt_baro"), (int, float))
    # General aviation often uses the registration as callsign; those have no scheduled route.
    is_registration = callsign == aircraft.get("r")
    return bool(callsign) and airborne and not is_registration and in_us(aircraft)


def load_cache():
    if CACHE_FILE.exists():
        return json.loads(CACHE_FILE.read_text(encoding="utf-8"))
    return {}


def save_cache(cache):
    CACHE_FILE.write_text(json.dumps(cache, indent=2), encoding="utf-8")


def fetch_route(session, callsign):
    """Returns {"origin", "destination", "flight_number"} or None if adsbdb doesn't know it."""
    for attempt in range(3):
        response = session.get(ROUTE_API.format(callsign), timeout=15)

        if response.status_code == 429:  # rate limited: back off and retry
            time.sleep(5 * (attempt + 1))
            continue
        if response.status_code == 404:  # unknown callsign
            return None
        response.raise_for_status()

        route = response.json()["response"]["flightroute"]
        return {
            "origin": route["origin"]["iata_code"],
            "destination": route["destination"]["iata_code"],
            "flight_number": route.get("callsign_iata") or callsign,
        }
    return None


def lookup_routes(callsigns, cache):
    missing = [c for c in callsigns if c not in cache]
    print(f"{len(callsigns)} callsigns, {len(missing)} not cached yet")

    with requests.Session() as session:
        for i, callsign in enumerate(missing, start=1):
            try:
                cache[callsign] = fetch_route(session, callsign)
            except (requests.RequestException, KeyError, ValueError) as error:
                # Don't cache failures, so they're retried on the next run.
                print(f"  {callsign}: lookup failed ({error})")
            if i % 50 == 0:
                print(f"  {i}/{len(missing)} looked up")
                save_cache(cache)  # keep progress if the run is interrupted
            time.sleep(REQUEST_DELAY_S)

    save_cache(cache)
    return cache


def distance_nm(a, b):
    """Great-circle (haversine) distance between two (lat, lon) points in nautical miles."""
    lat1, lon1, lat2, lon2 = map(math.radians, (*a, *b))
    h = (math.sin((lat2 - lat1) / 2) ** 2
         + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2)
    return 2 * EARTH_RADIUS_NM * math.asin(math.sqrt(h))


def status_of(aircraft):
    return (EMERGENCY_SQUAWKS.get(aircraft.get("squawk"))
            or EMERGENCY_FIELD.get(aircraft.get("emergency"))
            or "OK")


def build_record(aircraft, route, airports):
    speed = aircraft.get("gs") or CRUISE_SPEED_KT
    # A plane caught at 180 kt on approach would make a 2-hour trip look like 10 hours,
    # so estimates never assume less than normal cruise speed.
    cruise_speed = max(speed, CRUISE_SPEED_KT)
    origin = airports[route["origin"]]
    destination = airports[route["destination"]]

    # Whole trip: cruise time for the route distance plus a fixed allowance for taxi/climb/descent.
    route_nm = distance_nm(origin, destination)
    est_flight_dur = round(route_nm / cruise_speed * 60 + TAXI_CLIMB_DESCENT_MIN)

    # Fuel: enough to fly from the current position to the destination, plus reserve.
    remaining_hours = distance_nm((aircraft["lat"], aircraft["lon"]), destination) / cruise_speed
    burn = FUEL_BURN_KG_PER_HOUR.get(aircraft.get("category"), DEFAULT_FUEL_BURN)
    fuel_remaining = round(burn * (remaining_hours + RESERVE_FUEL_HOURS), -1)

    return {
        "flight_number": route["flight_number"],
        "aircraft_reg": aircraft.get("r", aircraft["hex"].upper()),
        "type": aircraft.get("t", "UNKN"),
        "airport_dep": route["origin"],
        "airport_dest": route["destination"],
        "est_flight_dur": est_flight_dur,
        "airspeed": round(speed),
        "altitude": round(aircraft["alt_baro"] / 100),  # flight level
        "status": status_of(aircraft),
        "squawk": aircraft.get("squawk", "0000"),
        "fuel_remaining": int(fuel_remaining),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--cache-only", action="store_true",
                        help="skip API lookups and use only routes already in the cache")
    args = parser.parse_args()

    airports = load_map_airports()
    snapshot = json.loads(SNAPSHOT_FILE.read_text(encoding="utf-8"))

    candidates = [a for a in snapshot["aircraft"] if is_candidate(a)]
    callsigns = sorted({a["flight"].strip() for a in candidates})
    routes = load_cache() if args.cache_only else lookup_routes(callsigns, load_cache())

    records = []
    for aircraft in candidates:
        route = routes.get(aircraft["flight"].strip())
        if not route:
            continue
        if route["origin"] not in airports or route["destination"] not in airports:
            continue
        if route["origin"] == route["destination"]:
            continue
        records.append(build_record(aircraft, route, airports))

    # The frontend keys aircraft by registration, so make sure each appears once.
    unique = {record["aircraft_reg"]: record for record in records}
    OUTPUT_FILE.write_text(json.dumps(list(unique.values()), indent=2) + "\n", encoding="utf-8")
    print(f"Kept {len(unique)} of {len(snapshot['aircraft'])} aircraft -> {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
