import ChartSkeletonFrame, { SKELETON_PULSE } from '@/components/ui/ChartSkeletonFrame';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

// Fixed, made-up heights (% of the plot), hand-picked to jump around between
// 20 and 93: the same on every render (no flicker or hydration mismatch, which
// Math.random would cause) without passing for real figures. Every bar, not
// every category, takes the next value, and 37 is prime, so the pattern
// doesn't visibly repeat with any number of bars per group.
const BAR_HEIGHTS = [
  42, 68, 25, 81, 54, 33, 90, 61, 47, 72, 20, 58, 86, 39, 65, 28, 77, 51, 35,
  93, 44, 70, 23, 59, 84, 31, 66, 49, 76, 37, 88, 55, 26, 63, 80, 41, 71,
];
const DEFAULT_BARS = 12;

/**
 * First-load placeholder for a bar chart: pulsing bars rising from the
 * baseline inside the shared ChartSkeletonFrame (axes, gridlines, legend).
 * Use it only while there is nothing to draw yet; on a refetch keep the old
 * chart under ChartLoading's `overlay` instead.
 *
 * `bars` is how many categories (X-axis positions, e.g. months) to draw;
 * match it to what the real chart usually shows so the placeholder has the
 * same density. `groups` is how many bars stand side by side in each
 * category, for a grouped chart (one bar per customer, say); 1 draws a single
 * bar per category.
 *
 * @param {{
 *   bars?: number,
 *   groups?: number,
 *   height?: number,
 *   axes?: boolean,
 *   legend?: boolean,
 *   legendItems?: number,
 *   label?: string,
 *   className?: string,
 * }} props
 */
export default function BarChartSkeleton({ bars = DEFAULT_BARS, groups = 1, ...frameProps }) {
  // At least one bar, so a 0 or a bad value still draws a placeholder.
  const count = Math.max(1, Math.floor(bars) || DEFAULT_BARS);

  return (
    <ChartSkeletonFrame xTicks={count} {...frameProps}>
      <div className="absolute inset-0 flex items-end justify-around gap-1 px-2">
        {Array.from({ length: count }, (_, category) => (
          // Up to 2.5rem (the charts' 40px MAX_BAR_SIZE) per bar, so a grouped category is as wide as the real one.
          <div
            key={category}
            className="flex h-full w-full items-end justify-center gap-0.5"
            style={{ maxWidth: `${groups * 2.5}rem` }}
          >
            {Array.from({ length: groups }, (_, bar) => (
              <Skeleton
                key={bar}
                className={cn(SKELETON_PULSE, 'w-full rounded-b-none rounded-t-md')}
                style={{ height: `${BAR_HEIGHTS[(category * groups + bar) % BAR_HEIGHTS.length]}%` }}
              />
            ))}
          </div>
        ))}
      </div>
    </ChartSkeletonFrame>
  );
}
