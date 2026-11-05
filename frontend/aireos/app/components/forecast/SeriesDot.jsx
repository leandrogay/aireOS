'use client';

// `delay` (ms) fades the dot in as its line is drawn past it (.line-dot-in).
export default function SeriesDot({ cx, cy, color, shape, delay }) {
  if (cx == null || cy == null) return null;
  const reveal = { className: 'line-dot-in', style: { animationDelay: `${delay}ms` } };
  if (shape === 'square') {
    return (
      <rect x={cx - 3.5} y={cy - 3.5} width={7} height={7} fill={color} stroke="#fff" strokeWidth={1} {...reveal} />
    );
  }
  if (shape === 'diamond') {
    return (
      <polygon
        points={`${cx},${cy - 5} ${cx + 5},${cy} ${cx},${cy + 5} ${cx - 5},${cy}`}
        fill={color}
        stroke="#fff"
        strokeWidth={1}
        {...reveal}
      />
    );
  }
  if (shape === 'triangle') {
    return (
      <polygon
        points={`${cx},${cy - 5} ${cx + 5},${cy + 4} ${cx - 5},${cy + 4}`}
        fill={color}
        stroke="#fff"
        strokeWidth={1}
        {...reveal}
      />
    );
  }
  return <circle cx={cx} cy={cy} r={3.5} fill={color} stroke="#fff" strokeWidth={1} {...reveal} />;
}
