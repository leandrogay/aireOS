'use client';

import { changePct, formatChangePct, parseIso } from '@/app/utils/periodComparison';
import { formatDateRange } from '@/lib/formatDateRange';

function formatDayMonth(iso) {
  return parseIso(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function Side({ title, range, totals, available = true }) {
  return (
    <div className="sm:flex-[2]">
      <p className="text-xs font-medium text-deep-violet-blue">{title}</p>
      <p className="text-xs text-deep-violet-blue/60">{formatDateRange(range.start, range.end)}</p>
      {available ? (
        <>
          <p className="text-base font-semibold text-deep-violet-blue">${totals.revenue.toLocaleString()}</p>
          <p className="text-xs text-deep-violet-blue/60">{totals.units.toLocaleString()} units</p>
        </>
      ) : (
        <p className="text-sm text-deep-violet-blue/50">No sales data for these dates</p>
      )}
    </div>
  );
}

/**
 * This period vs the "Compare to" baseline: both sides' dates, revenue and
 * units, and the % change, plus a note whenever the comparison isn't a
 * plain full-period one — trimmed to the data loaded so far, or (custom
 * baselines) a different number of sales weeks on each side.
 *
 * @param {{
 *   active: boolean,
 *   periodNames: { current: string, baseline: string },
 *   current: { start: string, end: string },
 *   baseline: { start: string, end: string, trimmedTo: string | null } | null,
 *   currentTotals: { revenue: number, units: number },
 *   baselineTotals: { revenue: number, units: number },
 *   baselineAvailable: boolean,
 *   weekCounts: { current: number, baseline: number } | null,
 *   loading?: boolean,
 *   error?: string | null,
 * }} props
 */
export default function PeriodComparisonDetail({
  active,
  periodNames,
  current,
  baseline,
  currentTotals,
  baselineTotals,
  baselineAvailable,
  weekCounts = null,
  loading = false,
  error = null,
}) {
  const pct = baselineAvailable ? changePct(currentTotals.revenue, baselineTotals.revenue) : null;
  const changeColorClass = pct > 0 ? 'text-green-600' : pct < 0 ? 'text-red-600' : 'text-deep-violet-blue';

  return (
    <div className="bg-white rounded-lg border border-lavander shadow-sm p-3 h-full">
      <p className="text-sm font-medium text-deep-violet-blue mb-2">Comparison</p>

      {!active && (
        <p className="text-deep-violet-blue/50 text-sm">
          Choose a period in &ldquo;Compare to&rdquo; above the chart to see how this period compares.
        </p>
      )}

      {active && loading && <p className="text-deep-violet-blue/70 text-sm">Loading comparison...</p>}
      {active && error && <p className="text-red-600 text-sm">{error}</p>}

      {active && !loading && !error && baseline && (
        <>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Side title={periodNames.current} range={current} totals={currentTotals} />
            <Side title={periodNames.baseline} range={baseline} totals={baselineTotals} available={baselineAvailable} />
            <div className="sm:flex-1">
              <p className="text-xs font-medium text-deep-violet-blue">Change</p>
              <p className={`flex items-center gap-1 text-base font-semibold ${changeColorClass}`}>
                {pct > 0 && <span aria-hidden="true">▲</span>}
                {pct < 0 && <span aria-hidden="true">▼</span>}
                {formatChangePct(pct)}
              </p>
            </div>
          </div>

          {baseline.trimmedTo && (
            <p className="mt-2 text-xs text-amber-700">
              Like-for-like: this period only has data to {formatDayMonth(baseline.trimmedTo)}, so the comparison
              stops at the same point.
            </p>
          )}
          {weekCounts && weekCounts.current !== weekCounts.baseline && (
            <p className="mt-2 text-xs text-amber-700">
              Different lengths: {weekCounts.current} sales {weekCounts.current === 1 ? 'week' : 'weeks'} vs{' '}
              {weekCounts.baseline} — totals aren&rsquo;t like-for-like.
            </p>
          )}
        </>
      )}
    </div>
  );
}
