import './regions.css';

// Storm cells (NO_GO_REGION) as closed corridors: a wide translucent band along the original
// route from the edge, a bar across the route at the edge itself, and a label when zoomed in or
// when the affected plane is selected. Mount inside the map's transformed group, after airports
// and before route changes, so the violet detour is drawn over the corridor it avoids.
// `scale` is 1/zoom so bars and text keep their screen size.
export default function RegionsOverlay({ regions, scale = 1, showLabels = false, selectedId = null }) {
  if (!regions?.length) return null;
  return (
    <g className="storm-regions" pointerEvents="none" aria-hidden="true">
      {regions.map(region => {
        const selected = region.agentId === selectedId;
        return (
          <g key={region.id} className="storm-region" data-region-status={region.status}
            data-region-agent={region.agentId} opacity={selected || !selectedId ? 1 : 0.55}>
            <path className="storm-corridor" d={region.corridorPath} />
            <path className="storm-corridor-edge" d={region.corridorPath} />
            {/* Bar across the route at the closure edge; the route heading is 0° = up. */}
            <g transform={`translate(${region.edge}) rotate(${region.edgeAngle}) scale(${scale})`}>
              <path className="storm-edge-bar" d="M-11,0 L11,0" />
            </g>
            {(showLabels || selected) && (
              <g transform={`translate(${region.edge}) scale(${scale})`}>
                <text className="storm-label" x={14} y={-14}>⛈ {region.label}</text>
                <text className="storm-label storm-label-detail" x={14} y={0}>{region.detail}</text>
              </g>
            )}
          </g>
        );
      })}
    </g>
  );
}
