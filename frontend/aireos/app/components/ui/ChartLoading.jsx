import { Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Loading state for a chart, shared by the dashboard, inventory and forecast
 * charts so every chart loads the same way.
 *
 * Two shapes:
 * - Placeholder (default): shown while there is no chart to draw yet. Pass
 *   the chart's height and frame in `className` so nothing jumps when the
 *   chart arrives.
 * - `overlay`: drawn over a chart that is already on screen while it
 *   refetches. The old chart stays put, dimmed and not hoverable, instead of
 *   flashing away and back. The parent must be `relative`. Only use it when
 *   the old data still fits the chart's axes (the dashboard does not: a
 *   week/month switch would label old buckets with the new granularity).
 *
 * @param {{
 *   label?: string,
 *   overlay?: boolean,
 *   className?: string,
 * }} props
 */
export default function ChartLoading({ label = 'Loading chart…', overlay = false, className }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex flex-col items-center justify-center gap-2 text-deep-violet-blue/60',
        overlay ? 'absolute inset-0 z-30 rounded-xl bg-white/70' : 'min-h-[220px] w-full',
        className,
      )}
    >
      <Loader2 className="size-6 motion-safe:animate-spin" aria-hidden="true" />
      <p className="text-sm">{label}</p>
    </div>
  );
}
