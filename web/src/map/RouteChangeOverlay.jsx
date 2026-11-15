import { useMemo } from 'react';
import { projection } from './geography.js';
import { routeChangeEmphasis, routeChangeGeometry } from './routeChangeOverlay.js';

// Mount inside the map's transformed SVG group, above routes and below aircraft.
// Dashed = the plan that was abandoned (to the previously designated airport, or the original
// curve for a detour); solid = the current path from the plane's position.
// `time` is the completed snapshot time; `scale` is 1/zoom so markers keep their screen size.
export default function RouteChangeOverlay({ flight, agent, time, scale = 1, selected = false, showLabel = false, opacity = 1 }) {
  const geometry = useMemo(() => routeChangeGeometry(flight, agent, { project: projection }), [flight, agent]);
  if (!geometry) return null;

  const diversion = geometry.type === 'diversion';
  const emphasis = routeChangeEmphasis(time, geometry.changedAt);
  const showText = selected || showLabel;
  const abandonedLabel = geometry.trigger === 'DESTCLOSED'
    ? `${geometry.previousAirport} closed` : `was ${geometry.previousAirport}`;

  return (
    <g className={`route-change-overlay route-change-${geometry.type}`}
      data-route-change-agent={agent.id ?? flight.agentId}
      data-route-change-type={geometry.type} data-changed-at={geometry.changedAt ?? undefined}
      opacity={opacity} pointerEvents="none" aria-hidden="true">
      <path className="route-change-old" d={geometry.oldPath} />
      <path className="route-change-new" d={geometry.newPath} />

      {geometry.arrowAngle !== null && (
        // Tip sits just short of the airport centre so it does not hide the airport icon.
        <path className="route-change-arrow" d="M0,0 L-10,-5 L-10,5 Z"
          transform={`translate(${geometry.newDestination}) rotate(${geometry.arrowAngle}) scale(${scale}) translate(-7,0)`} />
      )}

      {diversion && (
        <g className="route-change-abandoned" transform={`translate(${geometry.oldDestination}) scale(${scale})`}>
          <circle r={9} vectorEffect="non-scaling-stroke" />
          <path d="M-4.5,-4.5 L4.5,4.5 M4.5,-4.5 L-4.5,4.5" />
          {showText && <text className="route-change-label" x={12} y={-10}>{abandonedLabel}</text>}
        </g>
      )}

      {emphasis > 0 && (
        <circle className="route-change-pulse" cx={geometry.turn[0]} cy={geometry.turn[1]}
          r={(10 + 14 * (1 - emphasis)) * scale} opacity={emphasis} vectorEffect="non-scaling-stroke" />
      )}
    </g>
  );
}
