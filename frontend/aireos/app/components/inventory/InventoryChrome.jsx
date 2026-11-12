'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import ChartCard from '@/components/ui/ChartCard';
import { CHART_FRAME_CLASS } from '@/components/ui/ChartFrame';
import ChartLoading from '@/components/ui/ChartLoading';
import { glassSurfaceClass } from '@/components/ui/surfaceStyles';
import { formatMonth } from '@/app/utils/inventoryForm';
import useDelayedLoading from '@/hooks/useDelayedLoading';

// Same compact field styling as ForecastFilters, so the inventory filter
// card lines up with the sell-out forecast page.
export const filterLabelClass = 'mb-0.5 block text-[11px] text-deep-violet-blue/70';

// Data-entry fields. Same white/violet treatment as the filter bar, with the
// roomier size the forms need. Kept off formStyles.js because DOH Settings
// still uses those cream inputs.
export const formLabelClass = 'mb-0.5 block text-[11px] text-deep-violet-blue/70';
export const formFieldClass =
  'w-full min-w-0 max-w-full rounded-md border border-violet bg-white px-2.5 py-1.5 text-sm text-deep-violet-blue placeholder:text-deep-violet-blue/45 focus:border-deep-violet-blue focus:outline-none disabled:opacity-60';

const CLEAR_BUTTON_CLASS =
  'h-auto rounded-md border-deep-violet-blue/30 bg-white px-2 py-0.5 text-[10px] font-medium text-deep-violet-blue transition hover:bg-cream hover:text-deep-violet-blue disabled:opacity-40';

/**
 * @param {string} start 'YYYY-MM' or ''
 * @param {string} end 'YYYY-MM' or ''
 */
export function monthRangeLabel(start, end) {
  if (!start && !end) return 'All months';
  if (start && start === end) return formatMonth(start);
  const from = start ? formatMonth(start) : '…';
  const to = end ? formatMonth(end) : '…';
  return `${from} – ${to}`;
}

/**
 * @param {string[]} skus
 */
export function skuScopeLabel(skus) {
  if (!skus.length) return 'All SKUs';
  return skus.length === 1 ? '1 SKU' : `${skus.length} SKUs`;
}

export function StatTag({ label, value }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-lavander bg-lavander/60 px-2.5 py-1 text-[11px] text-deep-violet-blue">
      <span className="font-semibold uppercase tracking-wide text-deep-violet-blue/45">{label}</span>
      <span className="font-medium">{value}</span>
    </span>
  );
}

export function ScopeTag({ label, value }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-lavander bg-lavander/60 px-2.5 py-0.5 text-[11px] text-deep-violet-blue">
      <span className="font-semibold uppercase tracking-wide text-deep-violet-blue/45">{label}</span>
      {value}
    </span>
  );
}

/**
 * Filter card shared by the inventory tabs. Same arrangement as the forecast
 * page: a "Filters" heading, Clear, summary pills, then a row of fields that
 * share the width.
 *
 * @param {object} props
 * @param {boolean} props.canClear
 * @param {() => void} props.onClear
 * @param {import('react').ReactNode} [props.stats]
 * @param {import('react').ReactNode} [props.note]
 * @param {import('react').ReactNode} props.children
 */
export function InventoryFilterCard({ canClear, onClear, stats, note, children }) {
  return (
    <Card className={`${glassSurfaceClass} relative z-10 overflow-visible text-deep-violet-blue`}>
      <CardContent className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <p className="font-serif text-base text-deep-violet-blue">Filters</p>
            <Button type="button" variant="outline" size="xs" onClick={onClear} disabled={!canClear} className={CLEAR_BUTTON_CLASS}>
              Clear
            </Button>
          </div>
          {stats ? <div className="flex flex-wrap items-center justify-end gap-1.5">{stats}</div> : null}
        </div>
        <div className="flex flex-wrap items-end gap-2 [&>*]:min-w-[11rem] [&>*]:flex-1">{children}</div>
        {note ? <p className="text-[11px] text-deep-violet-blue/70">{note}</p> : null}
      </CardContent>
    </Card>
  );
}

/**
 * Chart card under the filters (ui/ChartCard): serif title and optional scope
 * tags saying which customer, SKUs and months the chart shows.
 *
 * @param {object} props
 * @param {string} props.title
 * @param {Array<{ label: string, value: string }>} [props.tags]
 * @param {import('react').ReactNode} props.children
 */
export function InventorySection({ title, tags, children }) {
  return (
    <ChartCard
      title={title}
      detail={tags?.length ? (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <ScopeTag key={tag.label} label={tag.label} value={tag.value} />
          ))}
        </div>
      ) : null}
    >
      {children}
    </ChartCard>
  );
}

/**
 * Chart slot with the shared chart loading states (ui/ChartLoading). The
 * first load shows a placeholder the size of the 280px chart frame (only if
 * it takes longer than a moment, see hooks/useDelayedLoading); after
 * that, a refetch (filter change, or refreshKey after a save) dims the old
 * chart under an overlay instead of swapping it out, so it doesn't flash.
 * A tab that has a chart-shaped placeholder (ui/BarChartSkeleton) passes it as
 * `placeholder` to replace the first-load spinner.
 *
 * @param {object} props
 * @param {boolean} props.loading
 * @param {boolean} props.ready true once there is data to draw
 * @param {import('react').ReactNode} [props.placeholder] first-load placeholder
 * @param {import('react').ReactNode} props.children the chart
 */
export function InventoryChartSlot({ loading, ready, placeholder, children }) {
  // A fast first load skips the placeholder instead of flashing it.
  const firstLoad = useDelayedLoading({ loading: loading && !ready });

  if (firstLoad.pending) {
    return (
      <div className={firstLoad.placeholderClass}>
        {placeholder ?? (
          <ChartLoading label="Loading inventory…" className={`${CHART_FRAME_CLASS} h-[290px]`} />
        )}
      </div>
    );
  }
  if (!ready) return null;

  // min-h so the overlay still fits when the chart is just its one-line empty state.
  return (
    <div className={`relative ${loading ? 'min-h-[120px]' : ''}`}>
      {children}
      {loading && <ChartLoading overlay label="Updating inventory…" />}
    </div>
  );
}
