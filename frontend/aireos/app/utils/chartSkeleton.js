// Pure helpers for the chart skeletons in components/ui (no React).

/**
 * SVG path for one placeholder line in LineChartSkeleton, in a 0-100 viewBox
 * (stretched to the plot with preserveAspectRatio="none").
 *
 * `heights` are % of the plot height, one per X-axis position. Each point
 * sits in the middle of its slot, the way ChartSkeletonFrame spaces its
 * X-axis stubs (justify-around), so a point lines up with its stub. Points
 * are joined with S-curves whose control points share the midpoint's x, so
 * the line eases between months like the real chart's monotone lines
 * instead of zig-zagging.
 *
 * @param {number[]} heights
 * @returns {string}
 */
export function skeletonLinePath(heights) {
  if (!heights.length) return '';
  const slot = 100 / heights.length;
  const points = heights.map((height, i) => [slot * (i + 0.5), 100 - height]);
  const [first, ...rest] = points;
  let path = `M ${round(first[0])} ${round(first[1])}`;
  let previous = first;
  for (const point of rest) {
    const midX = round((previous[0] + point[0]) / 2);
    path += ` C ${midX} ${round(previous[1])} ${midX} ${round(point[1])} ${round(point[0])} ${round(point[1])}`;
    previous = point;
  }
  return path;
}

// Two decimals keep the path short without visibly moving a point.
function round(value) {
  return Math.round(value * 100) / 100;
}
