import { cn } from '@/lib/utils';

// The plot area every chart card draws in: the solid chart panel
// (--aire-chart-surface; the translucent glass behind it washes out pale
// series colours). ui/chart's ChartContainer draws the same panel for charts
// not yet in a ChartFrame; inside one, the descendant rules below turn the
// container's own panel off, so there is one panel and the frame owns it.
// `relative` so the ChartLoading overlay can cover it. Pass the same class to
// the chart's first-load skeleton (BarChartSkeleton / LineChartSkeleton
// `className`) so the placeholder takes exactly the chart's space.
export const CHART_FRAME_CLASS =
  'relative overflow-visible rounded-xl bg-(--aire-chart-surface) p-2 [&_[data-slot=chart]]:rounded-none [&_[data-slot=chart]]:bg-transparent [&_[data-slot=chart]]:p-0';

// The one tooltip look: pass as ChartTooltipContent's className. A tooltip
// floats over the plot, so it stays solid white.
export const CHART_TOOLTIP_CLASS = 'border-violet/40 bg-white';

/**
 * The plot area of a chart inside a ChartCard. Wrap the ChartContainer in it;
 * put a legend footer or notes after it, outside the frame.
 *
 * `toolbar` is a row of controls that belong to the plot itself (a
 * ChartZoomButton), drawn inside the panel on its right. Its pr-2 is the
 * chart's right margin (every chart here uses `right: 8`), so the last
 * control's edge lines up with the end of the plot. The row is 32px (h-8):
 * a skeleton for a chart with a toolbar takes `height` = 32 + the
 * ChartContainer's height.
 *
 * `fill` grows the frame inside a `fill` ChartCard (or any flex column), for a
 * chart whose ChartContainer grows too (trendChart's CHART_SIZE_CLASS,
 * flex-1 with a 220px minimum). Its skeleton is a `fill` BarChartSkeleton.
 *
 * @param {{
 *   toolbar?: import('react').ReactNode,
 *   fill?: boolean,
 *   className?: string,
 *   children: import('react').ReactNode,
 * }} props
 */
export default function ChartFrame({ toolbar, fill = false, className, children }) {
  return (
    <div className={cn(CHART_FRAME_CLASS, fill && 'flex flex-1 flex-col', className)}>
      {toolbar ? <div className="relative z-10 flex h-8 items-center justify-end gap-2 pr-2">{toolbar}</div> : null}
      {children}
    </div>
  );
}
