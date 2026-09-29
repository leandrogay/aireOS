'use client';

import { Info } from 'lucide-react';
import { changePct, formatChangePct, parseIso } from '@/app/utils/periodComparison';

function formatDayMonth(iso) {
  return parseIso(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function weeksLabel(count) {
  return `${count} sales ${count === 1 ? 'week' : 'weeks'}`;
}

function toneClass(pct, neutral) {
  if (neutral || pct === null || pct === 0) return 'text-deep-violet-blue/70';
  return pct > 0 ? 'text-green-600' : 'text-red-600';
}

function Arrow({ pct }) {
  if (pct > 0) return <span aria-hidden="true">▲ </span>;
  if (pct < 0) return <span aria-hidden="true">▼ </span>;
  return null;
}

// Revenue and Volume growth as equal headline figures, side by side, so it
// reads at a glance whether revenue grew faster than volume (price or mix).
function GrowthFigure({ label, pct, neutral }) {
  return (
    <div className="flex-1">
      <p className="text-xs text-deep-violet-blue/70">{label}</p>
      <p className={`text-xl font-semibold tabular-nums ${toneClass(pct, neutral)}`}>
        <Arrow pct={pct} />
        {formatChangePct(pct)}
      </p>
    </div>
  );
}

// One period per row — name + short tag, revenue, units — so the card reads
// top-down in a narrow column instead of three squeezed side-by-side columns.
function PeriodRow({ name, tag, totals, available = true }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-t border-lavander py-1">
      <p className="min-w-0 truncate text-xs font-medium text-deep-violet-blue">
        {name}
        {tag && <span className="font-normal text-deep-violet-blue/60"> · {tag}</span>}
      </p>
      {available ? (
        <p className="shrink-0 text-right tabular-nums">
          <span className="text-sm font-semibold text-deep-violet-blue">${totals.revenue.toLocaleString()}</span>
          <span className="ml-1.5 text-xs text-deep-violet-blue/60">{totals.units.toLocaleString()} units</span>
        </p>
      ) : (
        <p className="shrink-0 text-xs text-deep-violet-blue/50">No sales data</p>
      )}
    </div>
  );
}

/**
 * This period vs the "Compare to" baseline, headline first: Revenue and
 * Volume growth as equal figures with the average-price change they imply
 * underneath, then one row per period. Dates aren't repeated here — the
 * Period and Compare to buttons already show them; a neutral note appears
 * only when the comparison needs explaining.
 *
 * - Partial period (this period runs past the latest data): the baseline
 *   is already cut to the same number of sales weeks (see comparisonRange),
 *   so the change is a fair like-for-like figure and keeps its green/red.
 * - Uneven lengths (e.g. a 5-week July vs a 4-week June): part of the
 *   change is just the extra week, so it's shown in a neutral colour.
 *
 * @param {{
 *   active: boolean,
 *   periodNames: { current: string, baseline: string },
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

  const revenuePct = baselineAvailable ? changePct(currentTotals.revenue, baselineTotals.revenue) : null;
  const volumePct = baselineAvailable ? changePct(currentTotals.units, baselineTotals.units) : null;
  // Average selling price = revenue per unit; its change is how much of the
  // revenue growth came from price or product mix rather than volume.
  const aspPct =
    baselineAvailable && currentTotals.units && baselineTotals.units
      ? changePct(currentTotals.revenue / currentTotals.units, baselineTotals.revenue / baselineTotals.units)
      : null;

  let note = null;
  if (uneven) {
    note = `Uneven lengths: ${weeksLabel(weekCounts.current)} vs ${weekCounts.baseline}, so part of the change is the extra week.`;
  } else if (partial) {
    note = `${periodNames.current} has data to ${formatDayMonth(baseline.trimmedTo)}, so both sides are cut to the same ${
      weekCounts ? weeksLabel(weekCounts.current) : 'weeks'
    }.`;
  }

  return (
    <div className="bg-white rounded-lg border border-lavander shadow-sm p-3 h-full">
      <p className="text-sm font-medium text-deep-violet-blue mb-1">Comparison</p>

      {!active && (
        <p className="text-deep-violet-blue/50 text-sm">
          Choose a period in &ldquo;Compare to&rdquo; above the chart to see how this period compares.
        </p>
      )}

      {active && loading && <p className="text-deep-violet-blue/70 text-sm">Loading comparison...</p>}
      {active && error && <p className="text-red-600 text-sm">{error}</p>}

      {active && !loading && !error && baseline && (
        <>
          <div className="mb-1 flex gap-3">
            <GrowthFigure label="Revenue" pct={revenuePct} neutral={uneven} />
            <GrowthFigure label="Volume" pct={volumePct} neutral={uneven} />
          </div>
          {aspPct !== null && (
            <p className="mb-2 text-xs text-deep-violet-blue/70">
              Avg price per unit <Arrow pct={aspPct} />
              {formatChangePct(aspPct)}
              {aspPct > 0 && ' — price or mix improved'}
              {aspPct < 0 && ' — price or mix softened'}
            </p>
          )}

          <PeriodRow name={periodNames.current} tag={partial ? 'to date' : null} totals={currentTotals} />
          <PeriodRow
            name={periodNames.baseline}
            tag={partial ? 'same weeks' : null}
            totals={baselineTotals}
            available={baselineAvailable}
          />

          {note && (
            <p className="mt-2 flex items-start gap-1.5 rounded-md bg-lavander/60 px-2 py-1 text-xs text-deep-violet-blue">
              <Info className="mt-px size-3.5 shrink-0" aria-hidden="true" />
              <span>{note}</span>
            </p>
          )}
        </>
      )}
    </div>
  );
}
