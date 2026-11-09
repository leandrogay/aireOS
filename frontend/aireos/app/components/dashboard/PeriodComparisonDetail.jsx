'use client';

import { ChangeFigure, ChangeValue, ComparisonNote } from '@/components/ui/ComparisonFigures';
import { Skeleton } from '@/components/ui/skeleton';
import { changePct, parseIso } from '@/app/utils/periodComparison';
import { formatRevenue } from '@/app/utils/trendChart';

function formatDayMonth(iso) {
  return parseIso(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// One period per row — name + short tag, revenue, units — so the card reads
// top-down in a narrow column instead of three squeezed side-by-side columns.
function PeriodRow({ name, tag, totals, available = true }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-1.5">
      <p className="min-w-0 truncate text-xs font-medium text-deep-violet-blue">
        {name}
        {tag && <span className="font-normal text-deep-violet-blue/60"> · {tag}</span>}
      </p>
      {available ? (
        <p className="shrink-0 text-right tabular-nums">
          <span className="text-sm font-semibold text-deep-violet-blue">{formatRevenue(totals.revenue)}</span>
          <span className="ml-1.5 text-xs text-deep-violet-blue/60">{totals.units.toLocaleString()} units</span>
        </p>
      ) : (
        <p className="shrink-0 text-xs text-deep-violet-blue/50">No sales data</p>
      )}
    </div>
  );
}

// Placeholder in the shape of the loaded card: the two growth figures, then
// one row per period, so the card keeps its layout while the baseline loads.
function ComparisonSkeleton() {
  return (
    <div role="status">
      <span className="sr-only">Loading comparison…</span>
      <div aria-hidden="true">
        <div className="flex gap-3">
          {['revenue', 'volume'].map((key) => (
            <div key={key} className="flex-1">
              <Skeleton className="h-3 w-14 rounded bg-lavander" />
              <Skeleton className="mt-1.5 h-6 w-20 rounded bg-lavander" />
            </div>
          ))}
        </div>
        <div className="mt-2 divide-y divide-lavander border-t border-lavander">
          {['current', 'baseline'].map((key) => (
            <div key={key} className="flex items-center justify-between gap-2 py-2">
              <Skeleton className="h-3 w-20 rounded bg-lavander" />
              <Skeleton className="h-4 w-28 rounded bg-lavander" />
            </div>
          ))}
        </div>
      </div>
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
 * - Lengths always match: every "Compare to" option, custom included, covers
 *   as many months as this period (see comparisonRange).
 *
 * Under the average-price change, `priceMix` (see priceMixEffects) splits
 * it into SKU prices vs product mix, so "price or mix" isn't left to guess.
 * - Missing data: when either period has no sales rows there is no fair
 *   change (this period's empty total would read as -100%), so the figures
 *   show "N/A" and the note names the period without data.
 *
 * @param {{
 *   active: boolean,
 *   periodNames: { current: string, baseline: string },
 *   baseline: { start: string, end: string, trimmedTo: string | null } | null,
 *   currentTotals: { revenue: number, units: number },
 *   baselineTotals: { revenue: number, units: number },
 *   currentAvailable?: boolean,
 *   baselineAvailable: boolean,
 *   priceMix?: { pricePct: number, mixPct: number } | null,
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
  currentAvailable = true,
  baselineAvailable,
  priceMix = null,
  loading = false,
  error = null,
}) {
  const partial = Boolean(baseline?.trimmedTo);

  const comparable = currentAvailable && baselineAvailable;
  const revenuePct = comparable ? changePct(currentTotals.revenue, baselineTotals.revenue) : null;
  const volumePct = comparable ? changePct(currentTotals.units, baselineTotals.units) : null;
  // Average selling price = revenue per unit; its change is how much of the
  // revenue growth came from price or product mix rather than volume.
  const aspPct =
    comparable && currentTotals.units && baselineTotals.units
      ? changePct(currentTotals.revenue / currentTotals.units, baselineTotals.revenue / baselineTotals.units)
      : null;

  let note = null;
  if (!comparable) {
    const missing = [
      !currentAvailable && periodNames.current,
      !baselineAvailable && periodNames.baseline,
    ].filter(Boolean);
    note = `No sales data for ${missing.join(' or ')}, so there is no % change to show.`;
  } else if (partial) {
    note = `${periodNames.current} has data to ${formatDayMonth(baseline.trimmedTo)}, so both sides are cut to the same sales weeks.`;
  }

  return (
    <div className="bg-white rounded-lg border border-lavander shadow-sm p-4 h-full">
      <h3 className="mb-1 font-serif text-base text-deep-violet-blue">Comparison</h3>

      {!active && (
        <p className="text-deep-violet-blue/50 text-sm">
          Choose a period in &ldquo;Compare to&rdquo; above the chart to see how this period compares.
        </p>
      )}

      {active && loading && <ComparisonSkeleton />}
      {active && error && <p className="text-red-600 text-sm">{error}</p>}

      {active && !loading && !error && baseline && (
        <>
          {/* Three groups, split by dividers: the headline growth figures,
              the average-price change and what drove it, then each
              period's totals. */}
          <div className="flex gap-3">
            {/* Green up, red down — always; any caveat goes in the note
                underneath, not in the colour. */}
            <ChangeFigure label="Revenue" pct={revenuePct} />
            <ChangeFigure label="Volume" pct={volumePct} />
          </div>

          {aspPct !== null && (
            <div className="mt-2 border-t border-lavander pt-2 text-xs text-deep-violet-blue/70">
              <p className="flex items-baseline justify-between gap-2">
                <span className="font-medium text-deep-violet-blue">Avg price per unit</span>
                <ChangeValue pct={aspPct} />
              </p>
              {priceMix && (
                <dl className="mt-1 grid grid-cols-[auto_auto_1fr] items-baseline gap-x-2 gap-y-0.5 pl-2">
                  <dt>Price</dt>
                  <dd>
                    <ChangeValue pct={priceMix.pricePct} />
                  </dd>
                  <dd className="text-deep-violet-blue/60">
                    <span className="mr-1.5 text-deep-violet-blue/30" aria-hidden="true">|</span>
                    {priceMix.pricePct > 0 && 'same SKUs selling for more'}
                    {priceMix.pricePct < 0 && 'same SKUs selling for less'}
                  </dd>
                  <dt>Mix</dt>
                  <dd>
                    <ChangeValue pct={priceMix.mixPct} />
                  </dd>
                  <dd className="text-deep-violet-blue/60">
                    <span className="mr-1.5 text-deep-violet-blue/30" aria-hidden="true">|</span>
                    {priceMix.mixPct > 0 && 'shift to higher-priced SKUs'}
                    {priceMix.mixPct < 0 && 'shift to lower-priced SKUs'}
                  </dd>
                </dl>
              )}
            </div>
          )}

          <div className="mt-2 divide-y divide-lavander border-t border-lavander">
            <PeriodRow
              name={periodNames.current}
              tag={partial ? 'to date' : null}
              totals={currentTotals}
              available={currentAvailable}
            />
            <PeriodRow
              name={periodNames.baseline}
              tag={partial ? 'same weeks' : null}
              totals={baselineTotals}
              available={baselineAvailable}
            />
          </div>

          {note && <ComparisonNote>{note}</ComparisonNote>}
        </>
      )}
    </div>
  );
}
