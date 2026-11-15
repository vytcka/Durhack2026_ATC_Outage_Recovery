import { closeCallLabel } from './closeCalls.js';

// Close calls drawn between the two planes involved. Mount inside the zoomed SVG group,
// above route guides and below aircraft. Markers only, never connector lines between planes.
// Red rings = loss now; amber rings = predicted loss. `scale` is 1/zoom.
export default function CloseCallsOverlay({ calls, scale = 1, showLabels = false, selectedId = null }) {
  if (!calls?.length) return null;
  return (
    <g className="close-calls" pointerEvents="none" aria-hidden="true">
      {calls.map(call => {
        const mid = [(call.from[0] + call.to[0]) / 2, (call.from[1] + call.to[1]) / 2];
        const involvesSelected = call.a === selectedId || call.b === selectedId;
        return (
          <g key={call.id} className={`close-call close-call-${call.kind}${involvesSelected ? ' is-selected' : ''}`}
            data-close-call={call.kind}>
            {[call.from, call.to].map((point, index) => (
              <circle key={index} className="close-call-ring" cx={point[0]} cy={point[1]} r={15 * scale} />
            ))}
            {(showLabels || involvesSelected) && (
              <g transform={`translate(${mid[0]},${mid[1]}) scale(${scale})`}>
                <text className="close-call-label" y={-6} textAnchor="middle">{closeCallLabel(call)}</text>
              </g>
            )}
          </g>
        );
      })}
    </g>
  );
}
