import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

const GRID_LINES = 4;
// Same pulse colour as TableSkeleton, held still for people who ask for less motion.
export const SKELETON_PULSE = 'rounded bg-lavander motion-reduce:animate-none';

/**
 * The part every chart skeleton shares (BarChartSkeleton, LineChartSkeleton):
 * the busy status for screen readers, the reserved height,
 * Y-axis stubs, gridlines, X-axis stubs and legend pills. The chart-type
 * skeleton draws its marks as `children`, laid over the plot area.
 *
 * `height` is the real chart's plotting height (its ChartContainer height) and
 * `className` the real chart's frame (border, padding), so the placeholder
 * takes exactly the space the chart will. Nothing in it carries a number, so
 * it can't be read as data.
 *
 * @param {{
 *   height?: number,
 *   axes?: boolean,
 *   legend?: boolean,
 *   legendItems?: number,
 *   label?: string,
 *   xTicks?: number,
 *   tiltXTicks?: boolean,
 *   fill?: boolean,
 *   className?: string,
 *   children: import('react').ReactNode,
 * }} props `xTicks`: how many X-axis stubs to draw (a bar chart passes its
 * category count so each stub sits under its bars). `legendItems`: how many
 * legend pills to draw when `legend` is on (one per series in the real chart).
 * `tiltXTicks`: draw the stubs slanted in a 48px axis row, for a chart whose
 * labels are angled (the forecast chart's -40° month labels).
 */
export default function ChartSkeletonFrame({
  height = 300,
  axes = true,
  legend = false,
  legendItems = 3,
  label = 'Loading chart…',
  xTicks = 12,
  tiltXTicks = false,
  fill = false,
  className,
  children,
}) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className={cn('w-full', fill && 'flex flex-col', className)}>
      <span className="sr-only">{label}</span>
      {/* fill: grow with the parent like a flex-1 chart, `height` being the minimum. */}
      <div
        aria-hidden="true"
        className={cn('flex flex-col py-2', fill && 'flex-1')}
        style={fill ? { minHeight: height } : { height }}
      >
        <div className="flex min-h-0 flex-1">
          {axes && <YAxisStubs />}
          <div className="relative flex-1 border-b border-lavander">
            <GridLines />
            {children}
          </div>
        </div>
        {axes && <XAxisStubs count={xTicks} tilted={tiltXTicks} />}
        {legend && <LegendStubs count={legendItems} />}
      </div>
    </div>
  );
}

// ==== Pieces ====

function GridLines() {
  return (
    <div className="absolute inset-0 flex flex-col justify-between">
      {Array.from({ length: GRID_LINES }, (_, i) => (
        <div key={i} className="border-t border-lavander/70" />
      ))}
    </div>
  );
}

function YAxisStubs() {
  return (
    <div className="flex w-12 shrink-0 flex-col justify-between py-0.5 pr-2">
      {Array.from({ length: GRID_LINES }, (_, i) => (
        <Skeleton key={i} className={cn(SKELETON_PULSE, 'ml-auto h-2.5 w-7')} />
      ))}
    </div>
  );
}

// Spaced like BarChartSkeleton's categories (justify-around, px-2) so each stub sits under its bars.
function XAxisStubs({ count, tilted }) {
  if (tilted) return <TiltedXAxisStubs count={count} />;
  return (
    <div className="flex h-8 shrink-0 items-start pt-2">
      <div className="w-12 shrink-0" />
      <div className="flex flex-1 justify-around gap-1 px-2">
        {Array.from({ length: count }, (_, i) => (
          <Skeleton key={i} className={cn(SKELETON_PULSE, 'h-2.5 w-full max-w-8')} />
        ))}
      </div>
    </div>
  );
}

// Same slots as XAxisStubs, each stub hanging down-left from its tick like
// Recharts' angle={-40} textAnchor="end" label. h-12 is the real axis height (48).
function TiltedXAxisStubs({ count }) {
  return (
    <div className="flex h-12 shrink-0 items-start pt-2">
      <div className="w-12 shrink-0" />
      <div className="flex flex-1 justify-around gap-1 px-2">
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="relative flex flex-1 justify-center">
            <div className="relative w-0">
              <Skeleton className={cn(SKELETON_PULSE, 'absolute right-0 top-0 h-2 w-9 origin-right -rotate-40')} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LegendStubs({ count }) {
  return (
    <div className="flex h-6 shrink-0 items-center justify-center gap-4">
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="flex items-center gap-1.5">
          <Skeleton className={cn(SKELETON_PULSE, 'size-2.5 rounded-sm')} />
          <Skeleton className={cn(SKELETON_PULSE, 'h-2.5 w-14')} />
        </span>
      ))}
    </div>
  );
}
