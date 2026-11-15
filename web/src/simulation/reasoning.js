// Pure formatters that turn an aircraft's recorded decisions and measured delay into readable text.
// No React and no geography, so everything here runs under `node --test`.
import { DISRUPTION_FACTORS } from './factorCatalogue.js';
import { formatSimulationTime } from './timing.js';
import { formatStep, PROCEDURE_BLOCK_BY_COMMAND } from './procedures.js';

const FACTOR_LABELS = Object.fromEntries(DISRUPTION_FACTORS.map(factor => [factor.id, factor.label]));
const SYNTHETIC_CAUSES = Object.freeze({
  DETOUR: 'Approved detour (longer route)',
  DIVERSION: 'Diversion leg',
  LOST_CONTACT: 'Lost-comms procedure',
  PROTOCOL: 'Message latency / retries',
  UNATTRIBUTED: 'Not attributed yet',
});
const POLICY_TEXT = Object.freeze({
  LANDNEARESTAIRPORT: 'nearest open airport',
  RETURNTOORIGIN: 'return to origin',
  PREFERRED: 'airport named by the lost-comms procedure',
});
const SOURCE_TEXT = Object.freeze({ agent: "this aircraft's procedure", default: 'the shared procedure', rulebook: 'the rulebook default' });

const clock = ms => (Number.isFinite(ms) ? formatSimulationTime(ms).slice(0, 5) : '—');
const defaultName = id => (typeof id === 'string' && id.startsWith('atc:') ? `${id.slice(4)} ATC` : String(id));

// 45 s -> "45 s", 11 min -> "11 min", 65 min -> "1 h 05 min".
export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '0 s';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
}

function listText(items) {
  const values = [...new Set((items ?? []).filter(Boolean))];
  if (values.length <= 1) return values[0] ?? '';
  return `${values.slice(0, -1).join(', ')} and ${values.at(-1)}`;
}

export function delayCauseLabel(cause) {
  return SYNTHETIC_CAUSES[cause] ?? FACTOR_LABELS[cause] ?? String(cause ?? '').toLowerCase().replaceAll('_', ' ');
}

/**
 * Measured delay causes, scaled so their sum equals `agent.totalDelayMs`, largest first.
 * A delay with no attribution recorded yet is reported as a single "not attributed" entry.
 */
export function delayBreakdown(agent) {
  const total = Math.max(0, Number(agent?.totalDelayMs) || 0);
  if (!(total > 0)) return [];
  const entries = Object.entries(agent?.delayByCause ?? {}).filter(([, ms]) => Number.isFinite(ms) && ms > 0);
  const raw = entries.reduce((sum, [, ms]) => sum + ms, 0);
  if (!(raw > 0)) return [{ cause: 'UNATTRIBUTED', label: delayCauseLabel('UNATTRIBUTED'), ms: total, share: 1 }];
  return entries
    .map(([cause, ms]) => ({ cause, label: delayCauseLabel(cause), ms: ms / raw * total, share: ms / raw }))
    .sort((a, b) => b.ms - a.ms || a.cause.localeCompare(b.cause));
}

function stepText(step) {
  if (!step) return 'unknown block';
  const block = PROCEDURE_BLOCK_BY_COMMAND[step.command];
  const text = formatStep(step);
  switch (step.command) {
    case 'SQUAWK': return `${text} (transponder${step.code === '7600' ? ' signals radio failure' : ' code set'})`;
    case 'CONTINUE': return `${text} (keep flying the route for ${step.minutes} min)`;
    case 'HOLD': return `${text} (stop and hold for ${step.minutes} min)`;
    case 'CIRCLE': return `${text} (orbit in place for ${step.minutes} min)`;
    case 'RELAY': return `${text} (send ATC requests through nearby aircraft)`;
    case 'DIVERT': return `${text} (${step.target === 'NEAREST' ? 'nearest open airport' : step.target === 'ORIGIN' ? 'return to origin' : `divert to ${step.target}`})`;
    default: return block ? text : String(step.command);
  }
}

/** One recorded decision as a sentence (the time is `entry.at`, shown separately by the UI). */
export function describeReasoning(entry, { nameOf = defaultName } = {}) {
  const name = id => nameOf(id) ?? defaultName(id);
  const atc = iata => name(`atc:${iata}`);
  switch (entry?.kind) {
    case 'DEPARTURE_REQUESTED': return `Requested departure clearance from ${atc(entry.airport)}.`;
    case 'DEPARTED': return `Cleared by ${atc(entry.airport)} and departed.`;
    case 'DESTINATION_CLOSED': return `${atc(entry.airport)} reported ${entry.airport} closed.`;
    case 'ALTERNATE_CHOSEN': {
      const policy = POLICY_TEXT[entry.policy] ?? 'alternate policy';
      const excluded = entry.excluded?.length ? `; excluded ${listText(entry.excluded)}` : '';
      return `Chose ${entry.airport} as the alternate (${policy}, ${entry.distanceNm} NM away${excluded}).`;
    }
    case 'ALTERNATE_REFUSED': return `${atc(entry.airport)} refused the alternate request (closed); asking the next airport.`;
    case 'DIVERSION_STARTED':
      return `Diverted from ${entry.previousAirport} to ${entry.airport}: ${entry.legNm} NM straight leg, about ${formatDuration(entry.legMs)}.`;
    case 'NO_GO_AHEAD': {
      const where = `${Math.round((entry.boundary ?? 0) * 100)}% along the route`;
      return entry.action === 'HOLD'
        ? `Closed corridor ahead at ${where}; holding at the boundary until it clears (rulebook HOLD).`
        : `Closed corridor ahead at ${where}; holding at the boundary while asking for a detour.`;
    }
    case 'REROUTE_REQUESTED': return 'Asked destination ATC for a detour around the closed corridor.';
    case 'REROUTE_APPROVED': return 'Detour approved: a longer bypass (about 1.5× the remaining effort).';
    case 'CONTACT_LOST':
      return `No reply from ${name(entry.controller)} for ${formatDuration(entry.silenceMs)}; started ${SOURCE_TEXT[entry.source] ?? 'the lost-comms procedure'}.`;
    case 'PROCEDURE_STEP': return `Procedure block ${(entry.index ?? 0) + 1}: ${stepText(entry.step)}.`;
    case 'CONTACT_RESTORED':
      return `Contact with ${name(entry.controller)} restored after ${formatDuration(entry.afterMs)}; procedure stopped.`;
    case 'LOW_RESERVE': return 'Virtual reserve fell below 20%; requesting priority.';
    case 'PRIORITY_REQUESTED': return `Requested priority handling from ${atc(entry.airport)}.`;
    case 'ARRIVAL_REQUESTED': return `Requested landing at ${entry.airport}.`;
    case 'ARRIVAL_APPROVED':
      return entry.waitedMs > 0
        ? `Landing approved at ${entry.airport} after ${formatDuration(entry.waitedMs)} waiting.`
        : `Landing approved at ${entry.airport}.`;
    default: return String(entry?.kind ?? 'Unknown decision').toLowerCase().replaceAll('_', ' ');
  }
}

const findLast = (entries, test) => [...(entries ?? [])].reverse().find(test);

/** Ordered sentences explaining a diversion: why, which airport, why that one, distance and time. */
export function explainDiversion(agent, flight) {
  const reasoning = agent?.reasoning ?? [];
  const diversion = agent?.diversion;
  if (!agent?.diverted || !diversion) {
    const pending = agent?.pendingAlternate;
    if (!pending) return [];
    const target = pending.airport ? `asking ${pending.airport}` : 'no open airport known yet';
    return [`Seeking an alternate (${POLICY_TEXT[pending.action] ?? 'alternate policy'}): ${target}.`];
  }
  const previous = diversion.previousAirport ?? flight?.airport_dest ?? 'the destination';
  const sentences = [];
  if (diversion.trigger === 'DESTCLOSED') {
    const closed = findLast(reasoning, entry => entry.kind === 'DESTINATION_CLOSED' && entry.airport === previous);
    sentences.push(`${previous} reported closed${closed ? ` at ${clock(closed.at)}` : ''} (destination closed).`);
  } else if (diversion.trigger === 'COMLOST') {
    const lost = findLast(reasoning, entry => entry.kind === 'CONTACT_LOST' && entry.at <= diversion.startedAt);
    sentences.push(`Lost contact with ${defaultName(lost?.controller ?? `atc:${previous}`)}${lost ? ` at ${clock(lost.at)}` : ''}; the lost-comms procedure ordered a diversion.`);
  } else if (diversion.trigger === 'LOWRESERVE') {
    sentences.push(`Virtual reserve ran low while waiting to land at ${previous}.`);
  } else {
    sentences.push(`Diverted away from ${previous}.`);
  }
  const chosen = findLast(reasoning, entry => entry.kind === 'ALTERNATE_CHOSEN' && entry.airport === diversion.airport);
  const policy = POLICY_TEXT[chosen?.policy ?? diversion.action] ?? 'alternate policy';
  const others = (chosen?.excluded ?? []).filter(iata => iata !== previous);
  const exclusions = [`${previous} (original destination)`, ...others.map(iata => `${iata} (closure reported)`)];
  sentences.push(`Policy: ${policy}; ${listText(exclusions)} excluded.`);
  const refused = reasoning.filter(entry => entry.kind === 'ALTERNATE_REFUSED' && entry.at <= diversion.startedAt)
    .map(entry => entry.airport);
  if (refused.length) sentences.push(`${listText(refused)} refused first (closed).`);
  const started = findLast(reasoning, entry => entry.kind === 'DIVERSION_STARTED' && entry.airport === diversion.airport);
  sentences.push(started
    ? `${diversion.airport} chosen: ${started.legNm} NM from the turn point.`
    : `${diversion.airport} chosen${chosen ? `: ${chosen.distanceNm} NM away when chosen` : ''}.`);
  sentences.push(`Approved by ${diversion.airport} ATC at ${clock(diversion.startedAt)}; ${formatDuration(diversion.durationMs)} leg.`);
  return sentences;
}
