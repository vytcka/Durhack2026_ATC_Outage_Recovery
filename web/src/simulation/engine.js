import { createAircraft, createAtc } from './agents.js';
import { decideAircraft } from './aircraftPolicy.js';
import { decideAtc } from './atcPolicy.js';
import { DISRUPTION_FACTORS, activeDisruptions, isLinkDown, packetLost } from './disruptions.js';
import { SIMULATION_MS, flightTiming } from './timing.js';
import { transportEffects } from './transport.js';
import { nodeEffects } from './nodeEffects.js';

const RUN_END = SIMULATION_MS - 1;

export class Simulation {
  #agents = new Map();
  #queue = [];
  #events = [];
  #flights;
  #options;
  #time = 0;
  #sequence = 0;
  #applied = new Set();
  #peerCandidates = new Map();
  #airportPositions = new Map();
  #stats = { sent: 0, delivered: 0, dropped: 0, rejected: 0, duplicates: 0, bandwidthDeferred: 0, restarts: 0 };

  constructor(flights, options = {}) {
    this.#options = structuredClone({ tickMs: 10_000, latencyMs: 10_000, timeoutMs: 60_000, seed: 1, disruptions: [], ...options });
    if (this.#options.stops?.length) throw new Error('Stop events are not supported; model delays using disruptions');
    if (!Number.isFinite(this.#options.tickMs) || this.#options.tickMs <= 0) throw new Error('tickMs must be positive');
    if (!Number.isFinite(this.#options.latencyMs) || this.#options.latencyMs < 0) throw new Error('latencyMs must be non-negative');
    if (!Number.isFinite(this.#options.timeoutMs) || this.#options.timeoutMs <= 0) throw new Error('timeoutMs must be positive');
    this.#options.disruptions = this.#options.disruptions.map((event, index) => ({
      ...event, id: event.id ?? `${event.factor}:${index}`,
      value: event.value ?? DISRUPTION_FACTORS.find(factor => factor.id === event.factor)?.defaultValue,
    }));
    const eventIds = new Set();
    for (const event of this.#options.disruptions) {
      if (typeof event.id !== 'string' || !event.id || eventIds.has(event.id)) throw new Error('Disruption IDs must be unique non-empty strings');
      eventIds.add(event.id);
      if (!DISRUPTION_FACTORS.some(factor => factor.id === event.factor && factor.implemented)) {
        throw new Error(`Disruption ${event.factor} is not implemented`);
      }
      if (!Number.isFinite(event.startMs) || !Number.isFinite(event.endMs) || event.startMs < 0 || event.endMs <= event.startMs || event.endMs > RUN_END + 1) {
        throw new Error('Disruption time window is invalid');
      }
      if (event.factor === 'PACKET_LOSS' && (!Number.isFinite(event.value) || event.value < 0 || event.value > 1)) {
        throw new Error('Packet loss probability must be between 0 and 1');
      }
      if (event.factor === 'DELIVERY_DELAY' && (!Number.isFinite(event.value) || event.value < 0)) {
        throw new Error('Delivery delay must be non negative');
      }
      if (event.factor === 'REDUCED_SPEED' && (!Number.isFinite(event.value) || event.value <= 0 || event.value > 1)) {
        throw new Error('Speed factor must be greater than 0 and at most 1');
      }
      const definition = DISRUPTION_FACTORS.find(factor => factor.id === event.factor);
      if (!Number.isFinite(event.value) || event.value < definition.min || event.value > definition.max) {
        throw new Error(`Invalid strength for ${event.factor}`);
      }
      if (definition.step >= 1 && !Number.isInteger(event.value)) throw new Error(`Strength for ${event.factor} must be an integer`);
    }
    this.#flights = structuredClone(flights);
    for (const [index, flight] of this.#flights.entries()) {
      if (!flight.airport_dep || !flight.airport_dest || !Number.isFinite(flight.est_flight_dur) || flight.est_flight_dur <= 0) {
        throw new Error(`Invalid flight at index ${index}`);
      }
      const aircraft = createAircraft(flight, index);
      this.#agents.set(aircraft.id, aircraft);
      for (const airport of [flight.airport_dep, flight.airport_dest]) {
        const id = `atc:${airport}`;
        if (!this.#agents.has(id)) this.#agents.set(id, createAtc(airport));
      }
      if (flight.origin) this.#airportPositions.set(`atc:${flight.airport_dep}`, flight.origin);
      if (flight.destination) this.#airportPositions.set(`atc:${flight.airport_dest}`, flight.destination);
    }
    const aircraft = [...this.#agents.values()].filter(agent => agent.kind === 'aircraft');
    for (const event of this.#options.disruptions) {
      if (!event.agentId) continue;
      const target = this.#agents.get(event.agentId);
      const definition = DISRUPTION_FACTORS.find(factor => factor.id === event.factor);
      if (!target || !definition.targetKinds.includes(target.kind)) throw new Error(`Invalid target for ${event.factor}`);
    }
    for (const agent of aircraft) this.#peerCandidates.set(agent.id, aircraft
      .filter(peer => peer.id !== agent.id && (peer.flight.airport_dep === agent.flight.airport_dep
        || peer.flight.airport_dest === agent.flight.airport_dest)).slice(0, 4).map(peer => peer.id));
  }

  #position(id) {
    if (id.startsWith('atc:')) return this.#airportPositions.get(id) ?? [0, 0];
    const agent = this.#agents.get(id);
    const from = agent.flight.origin ?? [0, 0];
    const to = agent.flight.destination ?? [0, 0];
    const progress = agent.diverted ? Math.max(0, 0.98 * (1 - (agent.travelWorkMs - agent.flight.est_flight_dur * 60_000) / 120_000)) : agent.progress;
    return from.map((value, index) => value + (to[index] - value) * progress);
  }

  #distance(a, b) {
    const first = this.#position(a), second = this.#position(b);
    return 111 * Math.hypot((first[0] - second[0]) * Math.cos(first[1] * Math.PI / 180), first[1] - second[1]);
  }

  #outOfRange(message) {
    const factors = activeDisruptions(this.#options.disruptions, message, this.#time).filter(event => event.factor === 'OBSERVATION_RANGE');
    return factors.length > 0 && this.#distance(message.from, message.to) > 5000 * Math.min(...factors.map(event => event.value));
  }

  #record(event) {
    this.#events.push({ ...event, time: this.#time });
    if (this.#events.length > 100) this.#events.shift();
  }

  #send(message) {
    const extraDelay = activeDisruptions(this.#options.disruptions, message, this.#time)
      .filter(event => event.factor === 'DELIVERY_DELAY').reduce((sum, event) => sum + event.value, 0);
    const envelope = {
      ...structuredClone(message), id: `message:${++this.#sequence}`,
      sentAt: this.#time,
      deliverAt: this.#time + Math.max(this.#options.tickMs, this.#options.latencyMs + extraDelay),
    };
    const effects = transportEffects(this.#options.disruptions, envelope, this.#time, this.#options.seed);
    envelope.logicalId = envelope.id;
    envelope.deliverAt += effects.jitterMs;
    if (effects.corrupted) {
      envelope.corrupted = true;
      envelope.payload = null;
    }
    this.#stats.sent += 1;
    if (isLinkDown(this.#options.disruptions, envelope, this.#time)
      || effects.drop || this.#outOfRange(envelope) || packetLost(this.#options.disruptions, envelope, this.#time, this.#options.seed)) {
      this.#stats.dropped += 1;
      this.#record({ type: 'MESSAGE_DROPPED', from: message.from, to: message.to, messageType: message.type });
      return;
    }
    this.#queue.push(envelope);
    for (let copy = 0; copy < effects.copies; copy += 1) {
      this.#queue.push({ ...structuredClone(envelope), id: `message:${++this.#sequence}` });
      this.#stats.sent += 1;
      this.#stats.duplicates += 1;
    }
    this.#record({ type: 'MESSAGE_SENT', from: message.from, to: message.to, messageType: message.type });
  }

  #step() {
    this.#time += this.#options.tickMs;
    const active = this.#options.disruptions.filter(event => event.startMs <= this.#time && this.#time < event.endMs);
    const previous = this.#options.disruptions.filter(event => event.startMs <= this.#time - this.#options.tickMs
      && this.#time - this.#options.tickMs < event.endMs);
    const sameEffects = active.length === previous.length && active.every((event, index) => event === previous[index]);
    for (const event of active.filter(item => item.factor === 'ATC_RESTART')) {
      for (const agent of this.#agents.values()) {
        const key = `${event.id}:${agent.id}`;
        if (agent.kind !== 'atc' || (event.agentId && event.agentId !== agent.id) || this.#applied.has(key)) continue;
        this.#applied.add(key);
        this.#agents.set(agent.id, { ...createAtc(agent.airport), offlineUntil: this.#time + event.value });
        this.#stats.restarts += 1;
        this.#record({ type: 'ATC_RESTARTED', agentId: agent.id });
      }
    }
    const pending = [];
    const deliveredByRecipient = new Map();
    for (const message of this.#queue.sort((a, b) => a.deliverAt - b.deliverAt)) {
      if (message.deliverAt > this.#time) {
        pending.push(message);
        continue;
      }
      const recipient = this.#agents.get(message.to);
      if (isLinkDown(this.#options.disruptions, message, this.#time)
        || this.#outOfRange(message) || transportEffects(this.#options.disruptions, message, this.#time, this.#options.seed).drop) {
        this.#stats.dropped += 1;
        this.#record({ type: 'MESSAGE_DROPPED', from: message.from, to: message.to, messageType: message.type });
        continue;
      }
      const budget = Math.min(Infinity, ...activeDisruptions(this.#options.disruptions, message, this.#time)
        .filter(event => event.factor === 'BANDWIDTH_LIMIT').map(event => event.value));
      const delivered = deliveredByRecipient.get(message.to) ?? 0;
      if (delivered >= budget) {
        pending.push(message);
        this.#stats.bandwidthDeferred += 1;
        continue;
      }
      if (recipient) {
        deliveredByRecipient.set(message.to, delivered + 1);
        recipient.inbox.push(structuredClone(message));
        this.#stats.delivered += 1;
        this.#record({ type: 'MESSAGE_DELIVERED', from: message.from, to: message.to, messageType: message.type, messageId: message.id });
      }
    }
    this.#queue = pending;

    // No policy receives the registry. All decisions precede every outgoing delivery.
    const decisions = [...this.#agents.values()].map(agent => {
      const idle = () => ({ next: agent, outgoing: [], events: [] });
      if (agent.kind === 'aircraft' && agent.phase === 'ARRIVED' && agent.inbox.length === 0) return idle();
      const environment = nodeEffects(active, agent, this.#time);
      if (agent.kind === 'atc') {
        if (!agent.inbox.length && !agent.background && !environment.backgroundDemand && !environment.decisionDelayMs) return idle();
        return decideAtc(agent, this.#time, this.#options.tickMs, this.#options.timeoutMs, environment);
      }
      const grounded = ['REQUESTING_DEPARTURE', 'AWAITING_CONFIRMATION'].includes(agent.phase);
      if (grounded && !agent.inbox.length && !agent.pendingMessages?.length && !environment.priority && !environment.decisionDelayMs
        && this.#time + environment.clockOffsetMs - agent.lastSentAt < this.#options.timeoutMs
        && this.#time - (agent.lastPeerReportAt ?? -Infinity) < 60_000) return idle();
      const movement = sameEffects ? environment : nodeEffects(previous, agent, this.#time - this.#options.tickMs);
      environment.speedFactor = movement.speedFactor;
      environment.climbFactor = movement.climbFactor;
      environment.burnMultiplier = movement.burnMultiplier;
      environment.noGoBoundary = movement.noGoBoundary;
      environment.visiblePeers = (this.#peerCandidates.get(agent.id) ?? [])
        .filter(id => this.#distance(agent.id, id) <= 500 * environment.rangeFactor).slice(0, 2);
      return decideAircraft(agent, this.#time, this.#options.timeoutMs, this.#options.tickMs, environment);
    });
    for (const decision of decisions) {
      this.#agents.set(decision.next.id, decision.next);
      for (const event of decision.events) {
        if (event.type === 'MESSAGE_REJECTED') this.#stats.rejected += 1;
        this.#record(event);
      }
    }
    for (const decision of decisions) for (const message of decision.outgoing) this.#send(message);
  }

  advanceTo(elapsed) {
    if (!Number.isFinite(elapsed)) throw new Error('Simulation time must be finite');
    const target = Math.floor(Math.min(RUN_END, Math.max(0, elapsed)) / this.#options.tickMs) * this.#options.tickMs;
    if (target < this.#time) {
      const fresh = new Simulation(this.#flights, this.#options);
      this.#agents = fresh.#agents;
      this.#queue = [];
      this.#events = [];
      this.#time = 0;
      this.#sequence = 0;
      this.#stats = { ...fresh.#stats };
      this.#applied = fresh.#applied;
    }
    while (this.#time < target) this.#step();
    return this.snapshot();
  }

  snapshot() {
    const aircraft = [...this.#agents.values()].filter(agent => agent.kind === 'aircraft').map(agent => ({
      id: agent.id, registration: agent.flight.aircraft_reg, flightNumber: agent.flight.flight_number,
      phase: agent.phase,
      progress: agent.diverted ? Math.max(0, 0.98 * (1 - (agent.travelWorkMs - agent.flight.est_flight_dur * 60_000) / 120_000)) : agent.progress,
      departedAt: agent.departedAt, diverted: agent.diverted ?? false,
      arrivalAirport: agent.arrivalAirport ?? agent.flight.airport_dest,
      climbProgress: agent.climbProgress ?? 0, reserve: agent.reserve ?? 1,
      knownPeers: Object.keys(agent.knownPeers ?? {}).length, priority: agent.priority ?? false,
      timeouts: agent.timeouts, plan: agent.plan,
      arrivedAt: agent.arrivedAt,
      ...flightTiming(agent, this.#time, this.#options),
    }));
    return structuredClone({
      time: this.#time, aircraft, events: this.#events,
      stats: {
        ...this.#stats, queued: this.#queue.length,
        atcAgents: this.#agents.size - aircraft.length,
        airborne: aircraft.filter(agent => ['EN_ROUTE', 'AWAITING_ARRIVAL'].includes(agent.phase)).length,
        arrived: aircraft.filter(agent => agent.phase === 'ARRIVED').length,
        disruptedFlights: aircraft.filter(agent => agent.delayed).length,
        currentlyDelayed: aircraft.filter(agent => agent.delayed && agent.phase !== 'ARRIVED').length,
        delayedArrivals: aircraft.filter(agent => agent.delayed && agent.phase === 'ARRIVED').length,
        totalDelayMs: aircraft.reduce((sum, agent) => sum + agent.totalDelayMs, 0),
        meanArrivalDelayMs: aircraft.some(agent => agent.phase === 'ARRIVED')
          ? aircraft.filter(agent => agent.phase === 'ARRIVED').reduce((sum, agent) => sum + agent.totalDelayMs, 0)
            / aircraft.filter(agent => agent.phase === 'ARRIVED').length : null,
        waiting: aircraft.filter(agent => !['EN_ROUTE', 'AWAITING_ARRIVAL', 'ARRIVED'].includes(agent.phase)).length,
        timeouts: aircraft.reduce((sum, agent) => sum + agent.timeouts, 0),
      },
    });
  }
}
