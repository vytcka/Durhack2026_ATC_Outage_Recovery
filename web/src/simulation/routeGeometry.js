// Illustrative corridor bypass, not a geographic obstacle solver.
// The zero-slope bump joins the original route without a position/heading jump.
export function routePose([[x0, y0], [x1, y1], [x2, y2]], t, reroute) {
  const u = 1 - t;
  let x = u * u * x0 + 2 * u * t * x1 + t * t * x2;
  let y = u * u * y0 + 2 * u * t * y1 + t * t * y2;
  let dx = 2 * u * (x1 - x0) + 2 * t * (x2 - x1);
  let dy = 2 * u * (y1 - y0) + 2 * t * (y2 - y1);
  if (reroute && t > reroute.startProgress && t < reroute.endProgress) {
    const span = reroute.endProgress - reroute.startProgress;
    const phase = Math.PI * (t - reroute.startProgress) / span;
    const bump = reroute.offset * Math.sin(phase) ** 2;
    const slope = reroute.offset * Math.PI / span * Math.sin(2 * phase);
    x += (y2 - y0) * bump;
    y -= (x2 - x0) * bump;
    dx += (y2 - y0) * slope;
    dy -= (x2 - x0) * slope;
  }
  return { position: [x, y], heading: Math.atan2(dx, -dy) * 180 / Math.PI };
}
