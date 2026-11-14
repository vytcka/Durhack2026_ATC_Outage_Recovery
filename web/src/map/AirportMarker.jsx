const ICON_SIZE = 16;

// Label offset from the marker for each side.
const LABEL_OFFSET = {
  e: { x: 15, y: 5, anchor: 'start' },
  w: { x: -15, y: 5, anchor: 'end' },
  n: { x: 0, y: -16, anchor: 'middle' },
  s: { x: 0, y: 24, anchor: 'middle' },
};

// One airport: plane icon + IATA code (+ full name when zoomed in).
// `scale` is 1/zoom so the marker stays the same size on screen.
export default function AirportMarker({ airport, position, scale, showName, selected, onClick }) {
  const label = LABEL_OFFSET[airport.label];

  return (
    <g
      className={selected ? 'airport selected' : 'airport'}
      transform={`translate(${position[0]},${position[1]}) scale(${scale})`}
      onClick={onClick}
    >
      <image
        href="/airport.svg"
        x={-ICON_SIZE / 2}
        y={-ICON_SIZE / 2}
        width={ICON_SIZE}
        height={ICON_SIZE}
      />
      <text className="code" x={label.x} y={label.y} textAnchor={label.anchor}>
        {airport.iata}
      </text>
      {showName && (
        <text className="name" x={label.x} y={label.y + 15} textAnchor={label.anchor}>
          {airport.name}
        </text>
      )}
    </g>
  );
}
