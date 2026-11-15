import { useState } from 'react';
import { formatDelay, formatSimulationTime } from '../simulation/timing.js';
import { AIRPORT_BY_IATA } from '../data/airports.js';
import { describeReasoning, delayBreakdown, explainDiversion } from '../simulation/reasoning.js';
import { PROCEDURE_BLOCKS, SUGGESTED_PROCEDURE_TEXT } from '../simulation/procedures.js';
import { FLIGHT_STATUS_BY_ID, flightStatus, isAirborne } from './flightStatus.js';
import { diversionActionLabel, diversionReason, policyLabel } from './flightText.js';
import { describeCloseCall } from './closeCalls.js';
import { activeProcedureStep, stepRemainingMinutes } from './holdingPattern.js';
import { formatAltitude } from './physics.js';
import ProcedureApply from './ProcedureApply.jsx';

const INPUT_STATUS_LABELS = { OK: 'OK', PANPAN: 'PAN-PAN', MAYDAY: 'MAYDAY' };
const PROCEDURE_SOURCES = { agent: 'its own procedure', default: 'the all-aircraft procedure', rulebook: 'the rulebook default' };
const PROCEDURE_OUTCOMES = {
  running: 'Running', 'contact-restored': 'Stopped: contact with ATC restored',
  completed: 'All blocks done; still listening for ATC', diverting: 'Ended by a Divert block',
};

// "02:31" from simulation ms, or "—".
const clockTime = ms => (ms === null || ms === undefined ? '—' : formatSimulationTime(ms).slice(0, 5));
const duration = ms => (ms > 0 ? formatDelay(ms) : '—');

// Block name and parameter as the editor shows them, e.g. "Circle around = 30".
function blockText(step) {
  const block = PROCEDURE_BLOCKS?.find(item => item.command === step?.command);
  const value = step?.minutes ?? step?.code ?? step?.target;
  return `${block?.label ?? step?.command ?? 'Block'}${value !== undefined && value !== null ? ` = ${value}` : ''}`;
}
const blockColor = step => PROCEDURE_BLOCKS?.find(item => item.command === step?.command)?.color;

// Compact details card for the selected aircraft: key facts up front, explanations and the
// lost-comms procedure folded away behind two toggles.
// `physics` is flightPhysics() for this flight: live phase, altitude, speed, vertical rate, fuel.
export default function AircraftInfo({
  flight, progress, agent, physics, onDisrupt, canDisrupt, diversionPolicy, onClose,
  closeCalls = [], nameOf = id => id, procedureText = '', defaultProcedureText = '', onProcedureChange, time = 0,
}) {
  const [panel, setPanel] = useState(null); // null | 'why' | 'comms'
  const status = flightStatus(agent);
  const statusInfo = FLIGHT_STATUS_BY_ID[status];
  const landed = agent?.phase === 'ARRIVED';
  const awaitingLanding = agent?.phase === 'AWAITING_ARRIVAL';
  const airborne = isAirborne(agent);
  const diverted = Boolean(agent?.diverted);
  const diversion = agent?.diversion;
  const newAirport = agent?.arrivalAirport ?? flight.to.iata;
  const previousAirport = diversion?.previousAirport ?? flight.to.iata;
  const reason = diverted ? diversionReason(diversion) : null;
  const action = diverted ? diversionActionLabel(diversion?.action) : null;
  const percent = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  const totalDelayMs = agent?.totalDelayMs ?? 0;
  const verticalRate = physics?.verticalRate ?? 0;
  const climbArrow = verticalRate > 50 ? ' ↑' : verticalRate < -50 ? ' ↓' : '';
  const nordo = !landed && agent?.squawk === '7600';
  const call = closeCalls.find(item => item.a === flight.agentId || item.b === flight.agentId) ?? null;
  const procedure = agent?.procedure ?? null;
  const procedureState = agent?.procedureState ?? null;
  const running = activeProcedureStep(agent);
  const remaining = stepRemainingMinutes(running, time);
  const measures = agent?.measures ?? {};

  const badge = awaitingLanding ? `${statusInfo.short} · landing` : statusInfo.short;

  let progressLabel = diverted ? `${percent}% to ${newAirport}` : `${percent}%`;
  if (!agent?.departedAt) progressLabel = 'Not departed';
  if (awaitingLanding) progressLabel = 'Awaiting landing';
  if (landed) progressLabel = diverted ? `Landed ${newAirport}` : 'Landed';

  const routeDecision = diverted
    ? `Diverted to ${newAirport} (${reason}${action ? `; ${action}` : ''})`
    : agent?.reroute ? 'ATC-approved corridor detour (longer route)' : 'Original route';
  const disruptHelp = 'Adds a disruption on the next tick, then pauses. Airport closure affects every flight using that '
    + `airport; diverting aircraft follow the diversion policy (${policyLabel(diversionPolicy).toLowerCase()}). `
    + 'Comms loss cuts this aircraft\'s ATC links for 15 minutes so its lost-comms procedure runs.';
  const toggle = id => setPanel(current => (current === id ? null : id));

  return (
    <section className="panel info aircraft-info" aria-label={`Flight ${flight.flight_number} details`}>
      <div className="info-header">
        <div className="info-code">
          {flight.flight_number} <span>{flight.aircraft_reg} · {flight.type}</span>
        </div>
        {nordo && <span className="nordo-badge mono" title="Radio failure: squawking 7600, running its lost-comms procedure">7600 · NORDO</span>}
        {onClose && (
          <button type="button" className="info-close" onClick={onClose} aria-label="Close flight details" title="Close">✕</button>
        )}
      </div>

      <div className="info-summary">
        <span className="status-badge" data-status={status} title={statusInfo.label}>{badge}</span>
        <span className="info-route mono" data-info="route"
          title={`${flight.from.city} → ${diverted ? (AIRPORT_BY_IATA[newAirport]?.city ?? newAirport) : flight.to.city}`}>
          {flight.from.iata} →{' '}
          {diverted ? <><s className="abandoned-airport">{previousAirport}</s> → <strong className="new-airport">{newAirport}</strong></> : flight.to.iata}
        </span>
      </div>

      {diverted && (
        <div className="diversion-note" data-info="diversion"
          title={`Original destination ${previousAirport} abandoned → now ${AIRPORT_BY_IATA[newAirport]?.name ?? newAirport}`}>
          {reason}{action ? ` · ${action}` : ''}
        </div>
      )}
      {call && (
        <div className="close-call-note" data-kind={call.kind} data-info="close-call">
          ⚠ {describeCloseCall(call, flight.agentId, nameOf)}
        </div>
      )}
      {running && (
        <div className="procedure-note" data-info="procedure-step">
          Lost comms · block {running.index + 1}/{procedure?.steps?.length ?? '?'}: <strong>{blockText(running.step)}</strong>
          {remaining !== null && <span className="mono"> · {formatDelay(remaining * 60_000)} left</span>}
        </div>
      )}

      {agent?.departedAt != null && (
        <div className="info-progress" role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
          <span style={{ width: `${percent}%`, background: statusInfo.color }} />
        </div>
      )}

      <dl className="info-facts mono">
        <div><dt>Delay</dt><dd data-info="total-delay">{totalDelayMs > 0 ? `+${formatDelay(totalDelayMs)}` : 'None'}</dd></div>
        <div><dt>Progress</dt><dd>{progressLabel}</dd></div>
        <div><dt>Due</dt><dd data-info="expected-arrival">{clockTime(agent?.expectedArrivalAt)}</dd></div>
        <div><dt>Arrived</dt><dd data-info="actual-arrival">{agent?.arrivedAt == null ? 'Pending' : clockTime(agent.arrivedAt)}</dd></div>
        <div><dt>Altitude</dt><dd data-info="altitude">{formatAltitude(physics?.altitudeFt ?? 0)}{climbArrow}</dd></div>
        <div><dt>Speed</dt><dd data-info="ground-speed">{physics?.groundSpeedKt ?? 0} kt</dd></div>
      </dl>

      {onDisrupt && (
        <div className="info-actions" title={disruptHelp}>
          <button type="button" disabled={!canDisrupt || agent?.phase !== 'EN_ROUTE' || diverted || Boolean(agent?.reroute)}
            onClick={() => onDisrupt('NO_GO_REGION')}>Block route</button>
          <button type="button" disabled={!canDisrupt || !airborne || diverted}
            onClick={() => onDisrupt('AIRPORT_CLOSURE')}>Close dest.</button>
          <button type="button" disabled={!canDisrupt || !airborne}
            onClick={() => onDisrupt('ATC_LINK_OUTAGE')}>Comms loss</button>
        </div>
      )}

      <div className="info-toggles" role="group" aria-label="Flight explanations">
        <button type="button" aria-expanded={panel === 'why'} onClick={() => toggle('why')}>Why?</button>
        <button type="button" aria-expanded={panel === 'comms'} onClick={() => toggle('comms')}
          data-alert={String(Boolean(running))}>Lost comms</button>
      </div>

      {panel === 'why' && (
        <div className="info-why" data-info="why">
          <h4>Delay {totalDelayMs > 0 ? <span className="mono">+{formatDelay(totalDelayMs)}</span> : <span className="muted">none</span>}</h4>
          {totalDelayMs > 0 && (
            <ul className="why-causes">
              {delayBreakdown(agent).map(item => (
                <li key={item.cause}>
                  <span>{item.label}</span>
                  <span className="mono">{formatDelay(item.ms)}</span>
                  <i style={{ width: `${Math.max(2, Math.round(item.share * 100))}%` }} aria-hidden="true" />
                </li>
              ))}
            </ul>
          )}
          {diverted && (
            <>
              <h4>Why it diverted</h4>
              <ul className="why-diversion">
                {explainDiversion(agent, flight).map((sentence, index) => <li key={index}>{sentence}</li>)}
              </ul>
            </>
          )}
          <h4>Measured</h4>
          <dl className="why-measures mono">
            <div><dt>Messages</dt><dd>{measures.sent ?? 0} sent · {measures.received ?? 0} recv · {measures.dropped ?? 0} lost</dd></div>
            <div><dt>Ground wait</dt><dd>{duration(measures.groundWaitMs)}</dd></div>
            <div><dt>En route</dt><dd>{duration(measures.enRouteMs)}</dd></div>
            <div><dt>Holding</dt><dd>{duration(measures.holdMs)}</dd></div>
            <div><dt>Landing wait</dt><dd>{duration(measures.arrivalWaitMs)}</dd></div>
            <div><dt>Lost contact</dt><dd>{duration(measures.lostContactMs)}</dd></div>
          </dl>
          <h4>Decisions</h4>
          {agent?.reasoning?.length ? (
            <ol className="why-timeline">
              {[...agent.reasoning].reverse().map((entry, index) => (
                <li key={`${entry.at}:${entry.kind}:${index}`}>
                  <span className="mono">{clockTime(entry.at)}</span> {describeReasoning(entry, { nameOf })}
                </li>
              ))}
            </ol>
          ) : <p className="muted">No decisions recorded yet.</p>}
        </div>
      )}

      {panel === 'comms' && (
        <div className="info-comms" data-info="lost-comms">
          <p className="muted">
            Squawk <span className="mono">{agent?.squawk ?? flight.squawk}</span>.{' '}
            {procedure ? <>On losing contact it follows {PROCEDURE_SOURCES[procedure.source] ?? 'its procedure'}.</> : 'No procedure loaded.'}
            {procedureState && !procedureState.active && <> {PROCEDURE_OUTCOMES[procedureState.outcome] ?? ''}{procedureState.outcome ? '.' : ''}</>}
          </p>
          {procedure?.steps?.length > 0 && (
            <ol className="procedure-running">
              {procedure.steps.map((step, index) => (
                <li key={index} data-active={String(running?.index === index)}
                  data-done={String(Boolean(procedureState?.active) && index < (procedureState?.stepIndex ?? 0))}
                  style={{ '--block': blockColor(step) }}>
                  {blockText(step)}
                  {running?.index === index && remaining !== null && <span className="mono"> · {formatDelay(remaining * 60_000)} left</span>}
                </li>
              ))}
            </ol>
          )}
          {onProcedureChange && (
            <ProcedureApply id={`procedure-${flight.agentId}`} label="This aircraft's own blocks" compact
              applied={procedureText} placeholder={defaultProcedureText?.trim() ? defaultProcedureText : SUGGESTED_PROCEDURE_TEXT}
              activeIndex={procedure?.source === 'agent' && running ? running.index : undefined}
              onApply={onProcedureChange} />
          )}
        </div>
      )}

      <details className="info-details">
        <summary>More details</summary>
        <dl className="info-grid mono">
          <dt>Agent state</dt>
          <dd>{agent?.phase.toLowerCase().replaceAll('_', ' ') ?? 'initialising'}</dd>

          <dt>Flight phase</dt>
          <dd>{physics ? physics.phase.toLowerCase() : 'ground'}</dd>

          <dt>Scheduled dep.</dt>
          <dd>{flight.departure_time ?? '00:00'} UTC</dd>

          <dt>Original dest.</dt>
          <dd data-info="original-airport">{flight.to.iata}{diverted ? ' (abandoned)' : ''}</dd>

          <dt>Current dest.</dt>
          <dd data-info="current-airport">{newAirport}</dd>

          <dt>Route</dt>
          <dd data-info="route-decision">{routeDecision}</dd>

          {agent?.protocolDecision && <>
            <dt>Protocol rule</dt>
            <dd data-info="protocol-decision">{agent.protocolDecision.trigger} → {agent.protocolDecision.action}</dd>
          </>}

          <dt>Departure delay</dt>
          <dd>{formatDelay(agent?.departureDelayMs)}</dd>

          <dt>Travel delay</dt>
          <dd data-info="travel-delay">{formatDelay(agent?.travelDelayMs)}</dd>

          <dt>Arrival wait</dt>
          <dd>{formatDelay(agent?.arrivalDelayMs)}</dd>

          <dt>Vertical rate</dt>
          <dd>{formatVerticalRate(verticalRate)}</dd>

          <dt>Fuel</dt>
          <dd>{(physics?.fuelKg ?? flight.fuel_remaining).toLocaleString('en-US')} kg</dd>

          {agent?.radioPath !== undefined && (
            <>
              <dt>Radio link</dt>
              <dd data-info="radio-link">{describeRadioLink(agent.radioPath, nameOf)}</dd>
            </>
          )}

          <dt>Known peers</dt>
          <dd>{agent?.knownPeers ?? 0}</dd>

          <dt>Priority</dt>
          <dd>{agent?.priority ? 'Yes' : 'No'}</dd>

          <dt>Climb / reserve</dt>
          <dd>{Math.round((agent?.climbProgress ?? 0) * 100)}% / {Math.round((agent?.reserve ?? 1) * 100)}%</dd>

          <dt>Timeouts</dt>
          <dd>{agent?.timeouts ?? 0}</dd>

          <dt>Input alt / speed</dt>
          <dd>FL{flight.altitude} · {flight.airspeed} kt</dd>

          <dt>Squawk</dt>
          <dd>{agent?.squawk ?? flight.squawk} · {INPUT_STATUS_LABELS[flight.status] ?? flight.status}</dd>
        </dl>
      </details>
    </section>
  );
}

// 1834 -> "↑ 1,800 ft/min", 0 -> "level"
function formatVerticalRate(feetPerMinute) {
  const rounded = Math.round(feetPerMinute / 100) * 100;
  if (rounded === 0) return 'level';
  const arrow = rounded > 0 ? '↑' : '↓';
  return `${arrow} ${Math.abs(rounded).toLocaleString('en-US')} ft/min`;
}

// ['aircraft:3', 'atc:ATL'] -> "ATL tower"
// ['aircraft:3', 'aircraft:7', 'atc:ATL'] -> "ATL tower via DL123"
// null -> "No coverage"
function describeRadioLink(path, nameOf) {
  if (!path) return 'No coverage';
  const tower = `${path.at(-1).slice(4)} tower`;
  const relays = path.slice(1, -1).map(nameOf);
  return relays.length ? `${tower} via ${relays.join(' → ')}` : tower;
}
