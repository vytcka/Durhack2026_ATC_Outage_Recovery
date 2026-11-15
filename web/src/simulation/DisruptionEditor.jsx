import { useId, useRef, useState } from 'react';
import { DISRUPTION_FACTORS } from './disruptions.js';
import './disruptionEditor.css';

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
const clamp = (value, min, max, fallback = min) => Math.min(max, Math.max(min, Number.isFinite(Number(value)) ? Number(value) : fallback));

export default function DisruptionEditor({ events = [], onChange, aircraft = [], airports = [], currentTime = 0 }) {
  const prefix = useId();
  const counter = useRef(0);
  const [factorId, setFactorId] = useState(DISRUPTION_FACTORS[0]?.id ?? '');
  const [target, setTarget] = useState('');
  const [startMinute, setStartMinute] = useState(0);
  const [duration, setDuration] = useState(30);
  const factor = DISRUPTION_FACTORS.find(item => item.id === factorId) ?? DISRUPTION_FACTORS[0];
  const [strength, setStrength] = useState(factor?.defaultValue ?? 1);
  const min = factor?.min ?? 0;
  const max = factor?.max ?? 1;
  const step = factor?.step ?? 0.1;
  const allowedTargets = new Set([
    ...(factor?.targetKinds.includes('aircraft') ? aircraft.map(agent => agent.id) : []),
    ...(factor?.targetKinds.includes('atc') ? airports.map(iata => `atc:${iata}`) : []),
  ]);
  const selectedTarget = allowedTargets.has(target) ? target : '';
  const selectFactor = event => {
    const next = DISRUPTION_FACTORS.find(item => item.id === event.target.value);
    setFactorId(event.target.value);
    setStrength(next?.defaultValue ?? 1);
    setTarget('');
  };

  const now = clamp(currentTime, 0, DAY_MS);
  const activationStart = Math.min(now + 10_000, 86_390_000);
  const canActivate = Boolean(factor) && activationStart > now;

  const addEvent = (startMs, seekTo) => {
    if (!factor) return;
    const occupied = new Set(events.map(event => event.id));
    let id;
    do { id = `disruption-${++counter.current}`; } while (occupied.has(id));
    const rawStrength = clamp(strength, min, max, factor.defaultValue ?? min);
    const event = {
      id,
      factor: factor.id,
      startMs,
      endMs: Math.min(DAY_MS, startMs + clamp(duration, 1, 1440) * MINUTE_MS),
      value: step >= 1 ? Math.round(rawStrength) : rawStrength,
      ...(selectedTarget ? { agentId: selectedTarget } : {}),
    };
    onChange([...events, event], seekTo);
  };

  const statusOf = event => now < event.startMs ? 'pending' : now >= event.endMs ? 'ended' : 'active';
  const activeCount = events.filter(event => statusOf(event) === 'active').length;
  const targetName = id => !id ? 'All nodes' : id.startsWith('atc:')
    ? `ATC · ${id.slice(4)}` : aircraft.find(agent => agent.id === id)?.flightNumber || id;
  const timeLabel = ms => {
    const seconds = Math.floor(clamp(ms, 0, DAY_MS) / 1000);
    return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
      .map(part => String(part).padStart(2, '0')).join(':');
  };

  return (
    <section className="disruption-editor" aria-label="Disruption editor">
      <h3>Disruptions</h3>
      <label htmlFor={`${prefix}-factor`}>Disruption factor</label>
      <select id={`${prefix}-factor`} value={factorId} onChange={selectFactor} aria-describedby={`${prefix}-description`}>
        {DISRUPTION_FACTORS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select>
      <p className="muted" id={`${prefix}-description`}>{factor?.description}</p>
      <label htmlFor={`${prefix}-target`}>Disruption target</label>
      <select id={`${prefix}-target`} value={selectedTarget} onChange={event => setTarget(event.target.value)}>
        <option value="">All applicable nodes</option>
        {factor?.targetKinds.includes('aircraft') && aircraft.map(agent => <option key={agent.id} value={agent.id}>{agent.flightNumber || agent.id}</option>)}
        {factor?.targetKinds.includes('atc') && airports.map(iata => <option key={`atc:${iata}`} value={`atc:${iata}`}>ATC · {iata}</option>)}
      </select>
      <label htmlFor={`${prefix}-start`}>Start minute</label>
      <input id={`${prefix}-start`} type="number" min={0} max={1439} step={1} value={startMinute} onChange={event => setStartMinute(clamp(event.target.value, 0, 1439))} />
      <label htmlFor={`${prefix}-duration`}>Duration (minutes)</label>
      <input id={`${prefix}-duration`} type="number" min={1} max={1440} step={1} value={duration} onChange={event => setDuration(clamp(event.target.value, 1, 1440))} />
      <label htmlFor={`${prefix}-strength`}>Disruption strength</label>
      <input id={`${prefix}-strength`} type="number" min={min} max={max} step={step} value={strength} onChange={event => setStrength(clamp(event.target.value, min, max))} aria-describedby={`${prefix}-unit`} />
      <span className="muted" id={`${prefix}-unit`}>{factor?.unit ?? 'strength'}</span>
      <div className="disruption-editor-actions">
        <button type="button" disabled={!factor} onClick={() => addEvent(clamp(startMinute, 0, 1439) * MINUTE_MS)}>Schedule disruption</button>
        <button type="button" disabled={!canActivate} onClick={() => { if (canActivate) addEvent(activationStart, activationStart); }}>Activate now</button>
      </div>
      <p className="muted">Changes pause playback and replay the edited scenario to the selected time. Activate now begins on the next tick.</p>
      {!canActivate && <p className="muted">No activation tick remains today. Schedule a disruption and rewind to an earlier time.</p>}
      <p className="disruption-editor-count" role="status">{activeCount} active · {events.length} scheduled</p>
      {events.length === 0 ? <p className="muted">No disruptions scheduled.</p> : (
        <ul className="disruption-editor-events" aria-label="Scheduled disruptions">
          {events.map(event => {
            const metadata = DISRUPTION_FACTORS.find(item => item.id === event.factor);
            return (
              <li key={event.id} data-status={statusOf(event)}>
                <strong>{metadata?.label ?? event.factor}</strong>
                <span className="muted">{targetName(event.agentId)} · {event.value} {metadata?.unit}</span>
                <span className="mono">{timeLabel(event.startMs)}–{timeLabel(event.endMs)} UTC · {statusOf(event)}</span>
                <button type="button" aria-label={`Remove ${metadata?.label ?? event.factor}, ${targetName(event.agentId)}, ${timeLabel(event.startMs)}`}
                  onClick={() => onChange(events.filter(item => item.id !== event.id), currentTime)}>Remove</button>
              </li>
            );
          })}
        </ul>
      )}
      <button type="button" disabled={events.length === 0} onClick={() => onChange([], currentTime)}>Clear all</button>
      <p className="muted">Toy simulation only; not an aviation safety tool.</p>
    </section>
  );
}
