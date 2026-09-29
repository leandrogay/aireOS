'use client';

import { Info } from 'lucide-react';
import { changePct, formatChangePct, parseIso } from '@/app/utils/periodComparison';
import { formatDateRange } from '@/lib/formatDateRange';

function formatDayMonth(iso) {
  return parseIso(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function weeksLabel(count) {
  return `${count} sales ${count === 1 ? 'week' : 'weeks'}`;
}

// Neutral context, not a warning: explains why the numbers are shaped the
// way they are before anyone reads the delta.
function StatusPill({ children }) {
  return (
    <p className="mb-2 flex items-start gap-1.5 rounded-md bg-lavander/60 px-2 py-1 text-xs text-deep-violet-blue">
      <Info className="mt-px size-3.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

function Side({ title, note, range, totals, available = true }) {
  return (
    <div className="sm:flex-[2]">
      <p className="text-xs font-medium text-deep-violet-blue">
        {title}
        {note && <span className="font-normal text-deep-violet-blue/60"> ({note})</span>}
      </p>
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
 * This period vs the "Compare to" baseline. Both sides show the dates that
 * were actually counted, so the user can see it's a matched window:
 *
 * - Partial period (this period runs past the latest data): this side is
 *   shown "to date" and the baseline is already cut to the same number of
 *   sales weeks (see comparisonRange), so the change is a fair like-for-like
 *   figure and keeps its green/red.
 * - Uneven lengths (e.g. a 5-week July vs a 4-week June): part of the
 *   change is just the extra week, so it's shown in a neutral colour rather
 *   than as good/bad performance.
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
  const partial = Boolean(baseline?.trimmedTo);
  const uneven = Boolean(weekCounts) && weekCounts.current !== weekCounts.baseline;
  const countedCurrent = partial ? { start: current.start, end: baseline.trimmedTo } : current;

  const pct = baselineAvailable ? changePct(currentTotals.revenue, baselineTotals.revenue) : null;
  const toneClass = uneven || pct === null || pct === 0
    ? 'text-deep-violet-blue/70'
    : pct > 0
      ? 'text-green-600'
      : 'text-red-600';

  let caption = null;
  if (uneven) caption = `${weeksLabel(weekCounts.current)} vs ${weekCounts.baseline} — not like-for-like`;
  else if (weekCounts) caption = `Like-for-like · ${weeksLabel(weekCounts.current)} each`;

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
          {partial && (
            <StatusPill>
              Partial period: {periodNames.current} has data to {formatDayMonth(baseline.trimmedTo)}, so it&rsquo;s
              compared with the same {weekCounts ? weeksLabel(weekCounts.current) : 'weeks'} of {periodNames.baseline}.
            </StatusPill>
          )}
          {uneven && (
            <StatusPill>
              Uneven lengths: {periodNames.current} has {weeksLabel(weekCounts.current)}, {periodNames.baseline} has{' '}
              {weekCounts.baseline}. Part of the change comes from that difference.
            </StatusPill>
          )}

          <div className="flex flex-col gap-2 sm:flex-row">
            <Side
              title={periodNames.current}
              note={partial ? 'to date' : null}
              range={countedCurrent}
              totals={currentTotals}
            />
            <Side
              title={periodNames.baseline}
              note={partial ? 'same weeks' : null}
              range={baseline}
              totals={baselineTotals}
              available={baselineAvailable}
            />
            <div className="sm:flex-1">
              <p className="text-xs font-medium text-deep-violet-blue">Change</p>
              <p className={`flex items-center gap-1 text-base font-semibold ${toneClass}`}>
                {pct > 0 && <span aria-hidden="true">▲</span>}
                {pct < 0 && <span aria-hidden="true">▼</span>}
                {formatChangePct(pct)}
              </p>
              {caption && <p className="text-xs text-deep-violet-blue/60">{caption}</p>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
