# Agent simulation: first working slice

This is an experimental coordination model, not an aviation procedure or safety system.

## Run

From `web/`:

- `npm run dev`: open Analytics, then Agent network / Scenario controls.
- `npm test`: clock, protocol, transport, isolation and replay tests.
- `npm run benchmark`: full-day core runs with 50 and 100 aircraft; no rendering included.
- `npm run build`: production app and worker bundles.

## Current behaviour

The viewer takes the first 25, 50 or 100 drawable records from `public/aircraft_info.json`.
Each journey gets an independent aircraft ID even if registrations repeat. Each distinct
origin/destination airport gets an ATC agent. This is not a random or representative traffic sample.

Aircraft request departure, receive a route offer, accept it, and wait for confirmation
before moving. ATC caches offers per aircraft, so retries reuse the same plan ID. At the
end of its nominal journey, an aircraft requests arrival approval. Without a reply it
waits near the end of its illustrative route and retries. It stays visible in green after approval.

Aircraft are yellow en route, orange when delayed or awaiting landing approval, and green
after successful arrival. A late landing stays green but retains its delay record. There is
no terminal stop/failure state or manual stop control: disrupted flights keep attempting
progress. Pausing the viewer does not add simulated delay.

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
day end remains pending, not failed.

Analytics counts each flight with positive accrued delay once, including after landing; late
arrivals are a separate completed-flight count. Total delay includes pending and landed flights.
Mean arrival delay includes only completed arrivals, including on-time arrivals with zero delay.
Elapsed delay freezes once the aircraft lands. Replaying restores the same metrics rather than
incrementing a global disruption counter on every tick.

The accepted route contains the origin and destination; the existing viewer draws the
illustrative curved path between them. There is no waypoint planner or altitude controller yet.

An outage before departure prevents takeoff. An outage en route does not erase an accepted
plan; the aircraft continues it, then waits if arrival approval cannot be obtained. These
are explicit toy fallback policies, not real lost-radio instructions.

## Files and boundaries

- `agents.js`: factories and independent decision policies.
- `engine.js`: private agent registry, time, message queue, commit phase and snapshots.
- `disruptions.js`: factor catalogue and implemented transport mechanisms.
- `timing.js`: fixed healthy-model timing reference, delay components and display formatting.
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

## Disruptions

Thirty factors are catalogued. Four mechanisms are implemented:

- `ATC_LINK_OUTAGE`: drops traffic to/from ATC at send and delivery time.
- `PACKET_LOSS`: drops outgoing messages using a deterministic seeded hash draw.
- `DELIVERY_DELAY`: adds milliseconds to outgoing delivery latency.
- `REDUCED_SPEED`: multiplies nominal route progress by a factor greater than zero and at most one.

Every event specifies `factor`, inclusive `startMs`, exclusive `endMs`, and optionally
`agentId` to limit it to links involving that node. Loss uses a `value` probability in
[0, 1]; delay uses `value` milliseconds; speed uses `value` as the remaining fraction of nominal
speed. Movement advances incrementally and does not jump when a slowdown starts or ends.
Unsupported factors are rejected, not ignored.

The UI exposes a global first-30-minutes outage, all-day packet loss, all-day added message
delay and travel speed from 25% to 100% of nominal. Changing settings restarts at midnight,
paused. Speed reduction is a toy progress constraint, not an aerodynamic model.

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

- The remaining 26 factors, peer relays and fallback-policy comparisons.
- Contended runway/arrival slots, separation constraints and conflict detection.
- Real departure timestamps: all aircraft currently request departure at day start.
- Physical fuel, altitude, weather, radio range and realistic holding trajectories.
- Historical crisis import, checkpoint optimisation and persistent run exports.

Arrival ATC currently approves valid model-generated arrival requests without capacity
constraints. Do not interpret successful arrivals as evidence of safe coordination.
