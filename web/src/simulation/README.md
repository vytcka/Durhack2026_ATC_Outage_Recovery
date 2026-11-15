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
the end of the 12-hour run remains pending, not failed.

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

- `agents.js`: factories and baseline departure/arrival protocol.
- `aircraftPolicy.js`, `atcPolicy.js`: local decision policies, relays, priorities and resource queues.
- `engine.js`: private agent registry, time, message queue, commit phase and snapshots.
- `factorCatalogue.js`: all thirty factors, value bounds, valid targets and model descriptions.
- `disruptions.js`, `transport.js`, `nodeEffects.js`: transport and node-capability effects.
- `DisruptionEditor.jsx`: timed/scoped event creation, activation and removal.
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

### Schematic limits

- Climb is a virtual capability proxy; no real altitude/descent or aircraft dynamics are solved.
- Reserve is a dimensionless coordination signal, not measured fuel. Exhaustion does not
  manufacture a crash or a terminal stop.
- Alternate negotiation currently offers the origin airport. The return leg is an explicit
  fixed two-minute schematic leg retracing the illustrative route, not a real travel-time estimate.
- Radio distances use approximate nominal coordinates; observations are not a surveillance model.
- A no-go event is a temporary corridor hold, not a geographic weather rerouter.
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
- Comparative policy experiments, realistic alternate selection and geographic rerouting.
- Real departure timestamps: `departure_time` (UTC) is a synthetic schedule, five flights every five minutes from midnight.
- Physical fuel/altitude/weather models, real radio propagation and realistic holding trajectories.
- Historical crisis import, checkpoint optimisation and persistent run exports.

Normal arrival service is unconstrained unless a resource, priority or demand event imposes
a shared budget. Do not interpret successful arrivals as evidence of safe coordination.
