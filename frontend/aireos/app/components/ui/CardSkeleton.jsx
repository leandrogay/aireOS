import { Skeleton } from '@/components/ui/skeleton';
import { SKELETON_PULSE } from '@/components/ui/ChartSkeletonFrame';
import { cn } from '@/lib/utils';

/**
 * Placeholder for one card on a loading page: the app's card frame (lavender
 * border, white, shadow-sm), a header of pulsing bars where the title,
 * subtitle and header buttons go, and a body the caller fills with
 * SkeletonBars, a chart skeleton or anything else. Put it inside a
 * PageSkeleton, which announces the loading state for the whole page.
 *
 * Every bar is text-shaped, never a number, so nothing can be read as data.
 *
 * @param {{
 *   title?: boolean,
 *   subtitle?: boolean,
 *   actions?: number,
 *   divider?: boolean,
 *   className?: string,
 *   bodyClassName?: string,
 *   children?: import('react').ReactNode,
 * }} props `actions`: how many button stubs to draw on the right of the
 * header (tabs, a collapse button). `divider`: a rule under the header, for
 * a card whose header is set off from its body (ScenarioPanel).
 */
export default function CardSkeleton({
  title = true,
  subtitle = false,
  actions = 0,
  divider = false,
  className,
  bodyClassName,
  children,
}) {
  const hasHeader = title || subtitle || actions > 0;

  return (
    <section className={cn('aire-card', className)}>
      {hasHeader && (
        <div className={cn('flex items-start justify-between gap-3 px-4 pt-4', divider && 'border-b border-lavander pb-2.5')}>
          <div className="min-w-0 flex-1 space-y-1.5">
            {title && <Skeleton className={cn(SKELETON_PULSE, 'h-4 w-36')} />}
            {subtitle && <Skeleton className={cn(SKELETON_PULSE, 'h-3 w-52 max-w-full')} />}
          </div>
          {actions > 0 && (
            <div className="flex shrink-0 gap-1.5">
              {Array.from({ length: actions }, (_, i) => (
                <Skeleton key={i} className={cn(SKELETON_PULSE, 'h-7 w-16 rounded-md')} />
              ))}
            </div>
          )}
        </div>
      )}
      <div className={cn('p-4', bodyClassName)}>{children}</div>
    </section>
  );
}

/**
 * A run of pulsing bars for the body of a CardSkeleton: lines of text, form
 * fields, filter pills, list items. Stacked by default; `inline` lays them
 * out in a wrapping row (a toolbar of filters).
 *
 * `widths` are Tailwind width classes, written out in full at the call site
 * so Tailwind sees them, and repeat when there are more bars than widths.
 * `className` goes on every bar (its height and rounding). `layout` replaces
 * the wrapper's own stacking for any other arrangement (a grid of tiles).
 *
 * @param {{
 *   count?: number,
 *   widths?: string[],
 *   inline?: boolean,
 *   layout?: string,
 *   className?: string,
 * }} props
 */
export function SkeletonBars({ count, widths = ['w-full'], inline = false, layout, className }) {
  const total = count ?? widths.length;

  return (
    <div className={layout ?? (inline ? 'flex flex-wrap items-center gap-2' : 'space-y-2')}>
      {Array.from({ length: total }, (_, i) => (
        <Skeleton key={i} className={cn(SKELETON_PULSE, 'h-3.5', widths[i % widths.length], className)} />
      ))}
    </div>
  );
}
