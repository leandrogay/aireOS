'use client';

// `delay` (ms) fades the dot in as its line is drawn past it (.line-dot-in).
// `fill` says something about the point by shape, never colour alone:
//   'filled' (default)  the usual dot
//   'half'              lower half filled (Current: medium confidence)
//   'hollow'            outline only (Current: low confidence; Actual: partial month)
//   'small'             a smaller filled dot (Current: unknown confidence)
export default function SeriesDot({ cx, cy, color, shape, delay, fill = 'filled' }) {
  if (cx == null || cy == null) return null;
  const reveal = { className: 'line-dot-in', style: { animationDelay: `${delay}ms` } };
  const hollow = fill === 'hollow';
  const size = fill === 'small' ? 0.6 : 1;
  const paint = hollow
    ? { fill: '#fff', stroke: color, strokeWidth: 1.6 }
    : { fill: fill === 'half' ? '#fff' : color, stroke: fill === 'half' ? color : '#fff', strokeWidth: fill === 'half' ? 1.6 : 1 };

  if (shape === 'square') {
    const half = 3.5 * size;
    return <rect x={cx - half} y={cy - half} width={half * 2} height={half * 2} {...paint} {...reveal} />;
  }
  if (shape === 'diamond') {
    const r = 5 * size;
    return (
      <g {...reveal}>
        <polygon points={`${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`} {...paint} />
        {fill === 'half' ? <polygon points={`${cx - r},${cy} ${cx + r},${cy} ${cx},${cy + r}`} fill={color} /> : null}
      </g>
    );
  }
  if (shape === 'triangle') {
    const r = 5 * size;
    return (
      <polygon
        points={`${cx},${cy - r} ${cx + r},${cy + r * 0.8} ${cx - r},${cy + r * 0.8}`}
        {...paint}
        {...reveal}
      />
    );
  }
  const r = 3.5 * size;
  return (
    <g {...reveal}>
      <circle cx={cx} cy={cy} r={r} {...paint} />
      {fill === 'half' ? <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 0 ${cx + r} ${cy} Z`} fill={color} /> : null}
    </g>
  );
}
