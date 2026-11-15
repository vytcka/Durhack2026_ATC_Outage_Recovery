import { useState } from 'react';
import { FLIGHT_STATUSES } from './flightStatus.js';
import './regions.css';

// Small inline swatches. Every one is 28×12 user units; colours come from CSS classes.
const SWATCHES = {
  rings: <><circle className="key-ring-outer" cx="14" cy="6" r="5.4" /><circle className="key-ring-inner" cx="14" cy="6" r="2.6" /></>,
  storm: <><path className="key-storm-band" d="M2 6 H26" /><path className="key-storm-edge" d="M2 6 H26" /><path className="key-storm-bar" d="M6 1 V11" /></>,
  abandoned: <><path className="key-old" d="M2 6 H22" /><path className="key-cross" d="M22 3 L27 9 M27 3 L22 9" /></>,
  detour: <path className="key-detour" d="M2 9 Q14 -3 26 9" />,
  diversion: <><path className="key-diversion" d="M2 6 H22" /><path className="key-diversion-head" d="M27 6 L21 2.5 L21 9.5 Z" /></>,
  loss: <><circle className="key-loss-ring" cx="6" cy="6" r="3.5" /><circle className="key-loss-ring" cx="22" cy="6" r="3.5" /></>,
  predicted: <><circle className="key-predicted" cx="6" cy="6" r="3.5" fill="none" /><circle className="key-predicted" cx="22" cy="6" r="3.5" fill="none" /></>,
  comms: <><g className="link-symbol" data-link="live" transform="translate(7,6) scale(0.75)">
    <circle className="link-badge" r="7.5" /><circle className="link-emitter" r="1.6" />
    <path className="link-wave" d="M-2.6 -2.6 A3.7 3.7 0 0 0 -2.6 2.6 M2.6 -2.6 A3.7 3.7 0 0 1 2.6 2.6" /></g>
    <g className="link-symbol" data-link="lost" transform="translate(21,6) scale(0.75)">
    <circle className="link-badge" r="7.5" /><circle className="link-emitter" r="1.6" />
    <path className="link-wave" d="M-2.6 -2.6 A3.7 3.7 0 0 0 -2.6 2.6 M2.6 -2.6 A3.7 3.7 0 0 1 2.6 2.6" />
    <path className="link-slash" d="M-5.3 5.3 L5.3 -5.3" /></g></>,
  orbit: <circle className="key-orbit" cx="14" cy="6" r="4.6" />,
};

// Each region or line on the map, what it shows, and how the simulation uses it.
const ENTRIES = [
  ['rings', 'Airport rings', 'Dashed outer ring: 30 NM terminal area around each airport. Solid inner ring: 10 NM approach zone, where arrivals queue for landing approval.'],
  ['storm', 'Storm cell (no-go region)', 'A storm closes part of one plane’s route from the share shown (e.g. 40%). The plane stops at the edge bar, asks its destination ATC for a detour and flies the longer violet bypass once approved. If the radio link is down it keeps holding until approval arrives.'],
  ['abandoned', 'Abandoned plan', 'Dashed red: the route or airport the plane gave up. ✕ marks a destination that reported itself closed.'],
  ['detour', 'Detour', 'Solid violet: the ATC-approved bypass around a storm, rejoining the route before landing. It costs extra time, which is counted as delay.'],
  ['diversion', 'Diversion', 'Solid cyan with an arrow: a straight leg from where the plane turned to its new airport, the nearest open one or its origin depending on the policy.'],
  ['loss', 'Close call: separation lost', 'Two airborne planes within 5 NM horizontally and 1,000 ft vertically right now.'],
  ['predicted', 'Close call ahead', 'Two planes that will come within 5 NM and 1,000 ft in the next 3 minutes if both hold course and speed.'],
  ['comms', 'Radio link', 'Icon only, with no connecting lines between planes. Green: in contact with its controller (the outer wave pulses while a message is being exchanged). Red with a slash: communication lost; its lost-comms procedure is running, or every message it sent this tick was lost.'],
  ['orbit', 'Lost-comms holding orbit', 'A plane that lost contact flies its procedure blocks in order. A CircleAround block circles here with no route progress. The red 7600 badge is the radio-failure transponder code.'],
];

// Explains every region type drawn on the map. Lives in the footer; the panel opens above it.
export default function MapKey() {
  const [open, setOpen] = useState(false);
  return (
    <span className="map-key">
      <button type="button" className="map-key-toggle" aria-expanded={open} aria-controls="map-key-panel"
        onClick={() => setOpen(value => !value)}>Map key</button>
      {open && (
        <div id="map-key-panel" className="panel map-key-panel" role="dialog" aria-label="Map key"
          onKeyDown={event => { if (event.key === 'Escape') setOpen(false); }}>
          <div className="map-key-header">
            <h2>Map key</h2>
            <button type="button" className="info-close" onClick={() => setOpen(false)} aria-label="Close map key" title="Close">✕</button>
          </div>
          <dl className="map-key-list">
            {ENTRIES.map(([swatch, title, text]) => (
              <div key={swatch} className="map-key-entry">
                <dt><svg viewBox="0 0 28 12" aria-hidden="true">{SWATCHES[swatch]}</svg></dt>
                <dd><strong>{title}</strong> {text}</dd>
              </div>
            ))}
          </dl>
          <h3>Aircraft colours</h3>
          <ul className="map-key-statuses">
            {FLIGHT_STATUSES.map(status => (
              <li key={status.id}>
                <i style={{ '--dot': status.color }} data-landed={String(status.landed)} aria-hidden="true" />
                {status.label}
              </li>
            ))}
          </ul>
          <p className="muted">Landed aircraft keep their colour but are dimmed, so a late, detoured or diverted landing never looks on time.</p>
        </div>
      )}
    </span>
  );
}
