// Pan/zoom for an <svg>, powered by d3-zoom (wheel, drag, pinch).
import { useEffect, useMemo, useState } from 'react';
import { zoom, zoomIdentity } from 'd3-zoom';
import { select } from 'd3-selection';
import 'd3-transition';
import { WIDTH, HEIGHT } from './geography.js';

export function useZoom(svgRef, maxZoom) {
  const [transform, setTransform] = useState(zoomIdentity);

  const behavior = useMemo(
    () =>
      zoom()
        .scaleExtent([1, maxZoom])
        .translateExtent([[-WIDTH * 0.1, -HEIGHT * 0.1], [WIDTH * 1.1, HEIGHT * 1.1]])
        .on('zoom', (event) => setTransform(event.transform)),
    [maxZoom]
  );

  useEffect(() => {
    const svg = select(svgRef.current);
    svg.call(behavior).on('dblclick.zoom', null);
    return () => svg.on('.zoom', null);
  }, [svgRef, behavior]);

  const animate = (method, value) =>
    select(svgRef.current).transition().duration(600).call(method, value);

  return {
    transform,
    zoomIn: () => animate(behavior.scaleBy, 1.6),
    zoomOut: () => animate(behavior.scaleBy, 1 / 1.6),
    reset: () => animate(behavior.transform, zoomIdentity),
    focus: ([x, y], k) =>
      animate(behavior.transform, zoomIdentity.translate(WIDTH / 2 - x * k, HEIGHT / 2 - y * k).scale(k)),
  };
}
