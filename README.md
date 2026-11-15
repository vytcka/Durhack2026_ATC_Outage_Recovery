# Agent simulation and disruption scenarios

This is an experimental coordination model, not an aviation procedure or safety system.

## Run

From `web/`:

- `npm run dev`: open Analytics, then Agent network / Scenario controls / Disruptions.
- `npm test`: clock, protocol, transport, isolation and replay tests.
- `npm run benchmark`: full 12-hour core runs with 50 and 100 aircraft; no rendering included.
- `npm run build`: production app and worker bundles.

## Current behaviour

The viewer takes the first 25, 50 or 100 drawable records from `public/aircraft_info.json`.
Each journey gets an independent aircraft ID even if registrations repeat. Each distinct
origin/destination airport gets an ATC agent. This is not a random or representative traffic sample.

Aircraft request departure, receive a route offer, accept it, and wait for confirmation
before moving. ATC caches offers per aircraft, so retries reuse the same plan ID. At the
end of its nominal journey, an aircraft requests arrival approval. Without a reply it
waits near the end of its illustrative route and retries. It stays visible after approval.

One status function (`map/flightStatus.js`) colours the map icon, the tracker row and the
aircraft card the same way: grey awaiting departure, yellow en route on time, rose delayed
(including a late departure), violet on an approved detour and cyan diverting to a new airport.
Diversion takes priority over detour, and detour over delay. Landed planes keep their status
colour and are dimmed: green only for an on-time landing, rose for a late landing and cyan for
a landing at an alternate, so a delayed or diverted flight never looks like an on-time one.
There is no terminal stop/failure state or manual stop control: disrupted flights keep
attempting progress. Pausing the viewer does not add simulated delay.

## Delay accounting

Delay is measured against a fixed synthetic healthy-model baseline, not observed airline
schedules. The source lacks scheduled timestamps. The baseline includes the normal initial
decision tick, four departure-message hops, nominal travel rounded to a whole tick, and two
arrival-message hops. Thus ordinary protocol latency and time quantisation do not count as
disruptions. Added message-delay events are excluded from that reference.

The baseline is anchored to day start, never reset to a delayed departure. Each flight records
departure delay, slower-travel delay, excess arrival-approval wait, expected arrival and actual
simulated arrival. The three delay components sum to the final arrival lateness. Unfinished
flights show delay accrued so far, not a fabricated final arrival time. A flight unfinished at
the end of the 12-hour run remains pending, not failed.

Analytics counts each flight with positive accrued delay once, including after landing; late
arrivals are a separate completed-flight count. Total delay includes pending and landed flights.
Mean arrival delay includes only completed arrivals, including on-time arrivals with zero delay.
Elapsed delay freezes once the aircraft lands. Replaying restores the same metrics rather than
incrementing a global disruption counter on every tick.

The accepted route contains the origin and destination; the viewer draws an illustrative
curved path. A closed corridor triggers `REROUTE_REQUEST` / `REROUTE_APPROVED`: the aircraft
holds at the boundary until a valid reply arrives, then follows a longer visible bypass.
Wind and speed restrictions still apply on that bypass. The selected route and aircraft
heading follow the detour, which joins smoothly from the current position and rejoins the
original path before arrival. There is no real weather-polygon planner or altitude controller.

An outage before departure prevents takeoff. An outage en route does not erase an accepted
plan; the aircraft continues it, then waits if arrival approval cannot be obtained. These
are explicit toy fallback policies, not real lost-radio instructions.

En-route aircraft ask their destination ATC for availability at the normal retry interval.
A communicated closure can trigger an early alternate request; the agent does not know an
airport is closed before a message arrives. It picks an alternate from the airports it knows
(the origin, or the nearest airport not known to be closed, depending on the policy), asks
**that airport's** ATC, and waits for its approval. A refusal marks the airport unavailable
and the next candidate is asked. On approval the aircraft turns at its current position and
flies a **straight leg** to the new airport (`diversion.mode: 'direct'`), then requests landing
there. The leg lasts its distance at the flight's own average ground speed (route length /
scheduled duration), at least one minute. Ending the closure does not revoke an accepted diversion.

A diverted snapshot reports `progress` as the fraction of that straight leg, plus `diversion`:
`airport`, `previousAirport`, `trigger`, `action`, `startedAt`, `startProgress` (route progress
at the turn), `fromPosition`, `destination` and the detour `reroute` active at the turn.
`pendingAlternate` shows an alternate still being negotiated.

Select an airborne plane for **Block route / detour** or **Close destination / divert**.
These add real 30-minute scenario events at the next tick and pause, rather than forcing
agent states. Resume playback to watch negotiation, movement and landing. Closing a shared
airport affects all flights using that airport, not just the selected plane. The settings sidebar
and aircraft card have dark, scrollable overflow for access to all controls.

### Route-change guides and the flight tracker

Every airborne diverted or detoured plane carries two guides attached to its current position
(full strength when selected, faded otherwise). Dashed is the abandoned plan, solid is the
current one:

- Diversion: a dashed straight line to the previously designated airport (marked ✕, labelled
  "DEN closed" or "was DEN"), and a solid cyan line with an arrowhead to the new airport.
- Detour: a dashed line stepping from the plane back to the original route and following it to
  the destination, and the solid violet detour curve from the plane to the same destination.

The selected plane also shows its flown track. The **Flight tracker** panel (top right) lists
flights with status counts and the filters Disrupted / All / Delayed / Diverted / Detours.
Diverted rows read `SDF → ~~DEN~~ → IND` with the reason. Choosing a row selects the plane and
centres the map on it.

### Rulebook

`options.rulebook` holds `TRIGGER: ACTION` lines (`rulebook.js`); omitted triggers keep the
defaults shown first:

- `COMLOST` (no reply from destination ATC for two timeouts while en route):
  `CONTINUE` | `LANDNEARESTAIRPORT` | `RETURNTOORIGIN`.
- `DESTCLOSED` (closure communicated by destination ATC): `RETURNTOORIGIN` | `LANDNEARESTAIRPORT`.
  Low virtual reserve while waiting to land uses the same alternate policy.
- `NOGOREGION` (closed route corridor): `DETOUR` (negotiate a bypass) | `HOLD` (wait at the boundary).

Each trigger fires at most once per flight. It sets `protocolDecision` and logs `RULE_TRIGGERED`.
The viewer's **Diversion policy** control sets `DESTCLOSED` (nearest open airport by default)
and passes the whole airport catalogue, so every catalogue airport gets an ATC agent and can
be an alternate.

## Files and boundaries

- `agents.js`: factories and baseline departure/arrival protocol.
- `aircraftPolicy.js`, `atcPolicy.js`: local decision policies, relays, priorities and resource queues.
- `engine.js`: private agent registry, time, message queue, commit phase and snapshots.
- `factorCatalogue.js`: all thirty factors, value bounds, valid targets and model descriptions.
- `disruptions.js`, `transport.js`, `nodeEffects.js`: transport and node-capability effects.
- `DisruptionEditor.jsx`: timed/scoped event creation, activation and removal.
- `timing.js`: fixed healthy-model timing reference, delay components and display formatting.
- `routeGeometry.js`: continuous illustrative detour positions and headings.
- `navigation.js`: engine-side positions (route curve or straight diversion leg) and nearest-alternate choice.
- `rulebook.js`: rulebook parsing and the supported trigger/action table.
- `map/flightStatus.js`: the single status/colour decision shared by map, tracker and card.
- `map/flightGeometry.js`, `map/routeChangeOverlay.js`: map-space poses, flown track and route-change guides.
  Every route point goes through `curveParam(flight, progress)`: engine time-progress → distance
  share (`map/physics.js` speed profile) → Bézier parameter (arc-length table). The detour window
  is mapped the same way, so planes, detour bumps, diversion turns and guides always line up.
- `map/physics.js`: climb/cruise/descent profile, live altitude, speed, vertical rate and fuel.
- `map/FlightTracker.jsx`, `map/flightTracker.js`: the tracker panel and its pure row logic.
- `simulation.worker.js`: worker request/reply adapter.
- `useAgentSimulation.js`: React lifecycle, worker cleanup and latest-target coalescing.
- `AgentNetworkPanel.jsx`: scenario controls, statistics and recent event inspection.

A decision policy sees only its own state, inbox, simulation time and current movement capability. It receives neither
the global registry nor the disruption list. The transport layer copies message payloads;
snapshots and input records are copied as well. No agent can directly read another agent's
private state through the policy interface.

Each 10-second simulation step:

1. Deliver eligible queued messages, dropping any whose ATC link is currently unavailable.
2. Compute all agent decisions before committing any of them.
3. Commit their next local states.
4. Schedule outgoing messages, applying link outage, packet loss and latency.

New messages cannot arrive during the same step that created them. The base delivery
latency is 10 seconds; arrivals are quantised to step boundaries. Timeouts trigger retries,
not an assumption that the other agent has failed. The default timeout is 60 seconds.

## Radio coverage (`radio.js`, `options.radio`)

`options.radio` is `true` (defaults: towers 150 nm, aircraft 100 nm) or
`{ aircraftRangeNm, towerRangeNm }`. The app passes the two Scenario-control sliders
(10–100 nm each, both 100 nm by default). Towers (ATC at every map airport) reach aircraft
within the tower range; aircraft reach each other within the aircraft range; towers are joined
by ground lines. The grid cell size follows the range, so shorter ranges search less. Each step,
every aircraft picks one uplink: its current tower while still in range, else the nearest tower
in range, else the nearest airborne aircraft that has an uplink (relays chain). Messages to or
from an aircraft without an uplink are dropped and counted as `noCoverage`, both when sent and
when they would be delivered. Aircraft-to-aircraft messages need direct range. Agent policies
are unchanged: they still address their departure/destination ATC; radio only decides whether
and through which hops a message physically travels. A coarse 4° grid keeps the per-step
nearest-node searches local. Without `radio`, as in the abstract unit tests, every node can
reach every other node.

## Disruptions

All thirty factors have schematic mechanisms. Each factor's description and strength unit are
displayed in the editor; these parameters are experimental, not aviation operating limits.

- Communication: ATC/peer link loss, directional failure, seeded packet loss, added latency,
  and recipient bandwidth budgets. Peers exchange reports and can relay a retry around a
  targeted direct ATC-link outage; a network-wide outage cannot be bypassed magically.
- Message/observation faults: duplicate envelopes, seeded out-of-order jitter, corrupted
  payloads, stale reports, missing acknowledgements and aircraft clock skew. Recipients
  validate reports and reject corruption instead of silently trusting damaged data.
- Aircraft: reduced speed, virtual climb constraints, increased virtual-reserve consumption,
  biased reported progress, reduced discovery/radio reach and delayed strategic decisions.
  Movement continues while decision processing is delayed. Low virtual reserve requests
  priority and, with increased burn and an unresponsive destination, an alternate.
- Airport coordination: runway closure, shared arrival intervals, inbox-processing budgets,
  one-shot controller restart/memory loss, required mid-route handover with lost replies,
  and airport closure/unavailability messages.
- Environment/demand: headwind progress penalty, crosswind runway restriction, a closed
  route corridor boundary, virtual background arrival reservations, emergency ordering,
  and constrained alternate-airport approvals.

Some effects require relevant traffic: peer outages need peer communication; alternate
capacity needs a diversion; priority changes order only when arrivals compete. A valid active
event does not guarantee a delayed flight. Counts reflect measured outcomes, not toggles.

Every event specifies `factor`, inclusive `startMs`, exclusive `endMs`, and optionally
`agentId` to limit it to links involving that node. Loss uses a `value` probability in
[0, 1]; delay uses `value` milliseconds; speed uses `value` as the remaining fraction of nominal
speed. Movement advances incrementally and does not jump when a slowdown starts or ends.
Unknown factors, invalid node types, unknown targets, duplicate event IDs, invalid strengths
and out-of-day windows are rejected. Airport-resource factors target controllers; aircraft-only
factors target aircraft. Target options are restricted accordingly.

The UI exposes a global first-30-minutes outage, whole-run packet loss, whole-run added message
delay and travel speed from 25% to 100% of nominal. Changing settings restarts at midnight,
paused. Speed reduction is a toy progress constraint, not an aerodynamic model.

### Activating a scenario

1. Select a disruption factor and target (all applicable nodes, an aircraft, or airport ATC).
2. Choose its strength and duration.
3. Use **Schedule disruption** for a chosen start minute, or **Activate now** for the next
   10-second simulation tick. Playback pauses at activation so the result can be inspected.
4. Resume playback or drag the day timeline. The event list shows pending/active/ended state.
5. Remove an event or clear all to replay the edited counterfactual scenario to the current
   time. Removing a past event intentionally removes its historical effects, not just future ones.

Reset preserves scheduled events for repeatable runs. Changing the aircraft count clears
custom events because aircraft IDs and available controllers may change. Quick controls and
custom events combine; clearing custom events does not reset quick-control sliders.

### Combining disruptions

Scheduled events already overlap: adding another does not replace the existing scenario.
Each retains its target, strength and time window. For example, a speed fraction of 0.8 and
a headwind penalty of 0.25 multiply to 0.6 of nominal progress, before climb, holds or detour
effort. Add a no-go corridor to require a route change; add a communication outage to delay
the approval for that change. A pure radio outage does not invent a geographic obstacle.
Slower travel also burns virtual reserve for longer and can lead to priority/alternate requests.

The batch editor can stage factors with individual strengths and targets, then schedule or
activate all staged rows together using the shared start/duration. It appends to existing
events. Outcomes still count each delayed flight once, not once per active factor.

### Schematic limits

- Climb is a virtual capability proxy; no real altitude/descent or aircraft dynamics are solved.
- Reserve is a dimensionless coordination signal, not measured fuel. Exhaustion does not
  manufacture a crash or a terminal stop.
- Alternate choice is the origin or the nearest catalogue airport by straight-line distance.
  It ignores runway length, capacity and weather; only communicated closures are avoided.
  The straight leg uses the flight's average ground speed, not winds or approach procedures.
  A diverted plane whose alternate later closes keeps retrying that alternate; it does not re-divert.
- Radio distances use approximate nominal coordinates; observations are not a surveillance model.
- A no-go event negotiates a schematic corridor bypass, not a geographic weather rerouter.
  Its fixed 1.5 effort multiplier slows progress along the remaining route; it is not a
  measured ratio of real navigable distances. The approved detour remains after the event
  ends so aircraft do not snap back onto the original route.
- Background demand consumes virtual slots, not additional hidden aircraft agents.
- ATC arrival/alternate approvals are cached so retries do not reserve another slot.
- Restart strength is reboot duration after activation; queued work and boot recovery can
  outlast an event's active window. Ending a fault does not erase already accrued delay.

## Time, replay and hardware

The UI displays completed worker states. It does not invent aircraft progress while the
engine is still computing. Only one worker is used for the entire model; clock updates
are coalesced so that seeks cannot create an unbounded worker request backlog.

Backward seeking reconstructs the model from its initial scenario and deterministically
replays to the target. This includes private agent memory, pending messages and retry
state. Packet-loss draws are keyed by seed, endpoints, message type and send time, rather
than a shared mutable random stream. Checkpoints are not implemented yet.

The engine retains only the latest 100 events. Replay regenerates prior events; this is
not a persistent full event archive. Benchmark heap figures describe the whole Node
process's current JS heap, not isolated worker memory or total system memory.

## Not implemented yet

- Validated aviation behaviour, separation constraints and conflict detection.
- Comparative policy experiments, suitability-based alternate selection and geographic rerouting.
- Real departure timestamps: `departure_time` (UTC) is a synthetic schedule, five flights every five minutes from midnight.
- Physical fuel/altitude/weather models, real radio propagation and realistic holding trajectories.
- Historical crisis import, checkpoint optimisation and persistent run exports.

Normal arrival service is unconstrained unless a resource, priority or demand event imposes
a shared budget. Do not interpret successful arrivals as evidence of safe coordination.
