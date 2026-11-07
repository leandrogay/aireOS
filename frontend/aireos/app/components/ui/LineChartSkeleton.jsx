import ChartSkeletonFrame from '@/components/ui/ChartSkeletonFrame';
import { skeletonLinePath } from '@/app/utils/chartSkeleton';

// Fixed, made-up heights (% of the plot) that drift up and down gently, like
// a monthly sales line, and are the same on every render (no flicker or
// hydration mismatch, which Math.random would cause). 23 is prime, so the
// shape doesn't visibly repeat with any number of points.
const LINE_HEIGHTS = [
  48, 55, 62, 58, 50, 44, 47, 56, 66, 71, 64, 52, 45, 41, 46, 54, 60, 57, 49,
  43, 50, 59, 53,
];
// Line n starts LINE_STEP further along LINE_HEIGHTS and sits LINE_LEVELS[n]
// higher or lower, so the lines differ in shape and level but still cross now
// and then, as forecast lines do. Five covers the forecast chart's four
// series plus the Scenario builder's Simulated line.
const LINE_STEP = 6;
const LINE_LEVELS = [0, 12, -10, 6, -16];
const DEFAULT_POINTS = 12;

/**
 * First-load placeholder for a line chart: pulsing lines across the shared
 * ChartSkeletonFrame (axes, gridlines, legend), with no point markers so it
 * can't pass for data. Use it only while there is nothing to draw yet; on a
 * refetch keep the old chart under ChartLoading's `overlay` instead.
 *
 * `points` is how many X-axis positions (e.g. months) each line runs
 * through; match it to what the real chart shows so the placeholder has the
 * same density. `lines` is how many lines to draw (one per series the real
 * chart will show), up to five.
 *
 * @param {{
 *   points?: number,
 *   lines?: number,
 *   height?: number,
 *   fill?: boolean,
 *   axes?: boolean,
 *   tiltXTicks?: boolean,
 *   legend?: boolean,
 *   legendItems?: number,
 *   label?: string,
 *   className?: string,
 * }} props
 */
export default function LineChartSkeleton({ points = DEFAULT_POINTS, lines = 1, ...frameProps }) {
  // At least one point and one line, so a 0 or a bad value still draws a placeholder.
  const pointCount = Math.max(1, Math.floor(points) || DEFAULT_POINTS);
  const lineCount = Math.min(LINE_LEVELS.length, Math.max(1, Math.floor(lines) || 1));

  return (
    <ChartSkeletonFrame xTicks={pointCount} {...frameProps}>
      {/* px-2 matches the X-axis stubs' inset, so each point sits over its stub. */}
      <div className="absolute inset-0 px-2 py-3 text-lavander motion-safe:animate-pulse">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="size-full overflow-visible">
          {Array.from({ length: lineCount }, (_, line) => (
            <path
              key={line}
              d={skeletonLinePath(lineHeights(pointCount, line))}
              fill="none"
              stroke="currentColor"
              strokeWidth={2.4}
              strokeLinecap="round"
              strokeLinejoin="round"
              // Keeps the stroke 2.4px (the real lines' width) however far the viewBox is stretched.
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
      </div>
    </ChartSkeletonFrame>
  );
}

function lineHeights(count, line) {
  return Array.from(
    { length: count },
    (_, i) => LINE_HEIGHTS[(i + line * LINE_STEP) % LINE_HEIGHTS.length] + LINE_LEVELS[line],
  );
}
