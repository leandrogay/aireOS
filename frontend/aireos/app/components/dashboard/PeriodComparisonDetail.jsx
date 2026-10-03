'use client';

import { Info } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { changePct, formatChangePct, parseIso } from '@/app/utils/periodComparison';

function formatDayMonth(iso) {
  return parseIso(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function weeksLabel(count) {
  return `${count} sales ${count === 1 ? 'week' : 'weeks'}`;
}

// Green up, red down — always, even with uneven period lengths, where the
// note underneath explains the caveat instead of the colour.
function toneClass(pct) {
  if (pct === null || pct === 0) return 'text-deep-violet-blue/70';
  return pct > 0 ? 'text-green-600' : 'text-red-600';
}

// "▲ +12.8%" in its tone, for the smaller figures under the headline.
function Change({ pct }) {
  return (
    <span className={`font-medium tabular-nums ${toneClass(pct)}`}>
      <Arrow pct={pct} />
      {formatChangePct(pct)}
    </span>
  );
}

function Arrow({ pct }) {
  if (pct > 0) return <span aria-hidden="true">▲ </span>;
  if (pct < 0) return <span aria-hidden="true">▼ </span>;
  return null;
}

// Revenue and Volume growth as equal headline figures, side by side, so it
// reads at a glance whether revenue grew faster than volume (price or mix).
// With no change to show (a side has no data, or the comparison is zero) it
// reads "N/A" in a muted tone with no arrow, so missing data never looks
// like a -100% collapse.
function GrowthFigure({ label, pct }) {
  return (
    <div className="flex-1">
      <p className="text-xs text-deep-violet-blue/70">{label}</p>
      {pct === null ? (
        <p className="text-xl font-semibold text-deep-violet-blue/40" title="Data not available">
          N/A
        </p>
      ) : (
        <p className={`text-xl font-semibold tabular-nums ${toneClass(pct)}`}>
          <Arrow pct={pct} />
          {formatChangePct(pct)}
        </p>
      )}
    </div>
  );
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
          <span className="text-sm font-semibold text-deep-violet-blue">${totals.revenue.toLocaleString()}</span>
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
 * - Uneven lengths (e.g. a 5-week July vs a 4-week June): part of the
 *   change is just the extra week, which the note says.
 *
 * Under the average-price change, `priceMix` (see priceMixEffects) splits
 * it into SKU prices vs product mix, so "price or mix" isn't left to guess.
 * - Shortened custom period: a custom baseline longer than this period is
 *   cut to its first weeks (see comparisonRange's `shortenedTo`), which the
 *   note says, since its row is still named after the whole period picked.
 * - Missing data: when either period has no sales rows there is no fair
 *   change (this period's empty total would read as -100%), so the figures
 *   show "N/A" and the note names the period without data.
 *
 * @param {{
 *   active: boolean,
 *   periodNames: { current: string, baseline: string },
 *   baseline: { start: string, end: string, trimmedTo: string | null, shortenedTo: number | null } | null,
 *   currentTotals: { revenue: number, units: number },
 *   baselineTotals: { revenue: number, units: number },
 *   currentAvailable?: boolean,
 *   baselineAvailable: boolean,
 *   weekCounts: { current: number, baseline: number } | null,
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
  weekCounts = null,
  priceMix = null,
  loading = false,
  error = null,
}) {
  const partial = Boolean(baseline?.trimmedTo);
  const shortened = Boolean(baseline?.shortenedTo);
  const uneven = Boolean(weekCounts) && weekCounts.current !== weekCounts.baseline;

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
  } else if (uneven) {
    // Say which side has the extra week(s) and which way that skews the
    // change: more weeks in the comparison drag the % down, more weeks in
    // this period lift it.
    const extra = Math.abs(weekCounts.current - weekCounts.baseline);
    const longerIsBaseline = weekCounts.baseline > weekCounts.current;
    const longer = longerIsBaseline ? periodNames.baseline : periodNames.current;
    const counts = longerIsBaseline
      ? `${weekCounts.baseline} vs ${weekCounts.current}`
      : `${weekCounts.current} vs ${weekCounts.baseline}`;
    note = `${longer} has ${extra} extra sales ${extra === 1 ? 'week' : 'weeks'} (${counts}), so the % change reads ${
      longerIsBaseline ? 'lower' : 'higher'
    } than a like-for-like comparison.`;
  } else if (partial) {
    note = `${periodNames.current} has data to ${formatDayMonth(baseline.trimmedTo)}, so both sides are cut to the same ${
      weekCounts ? weeksLabel(weekCounts.current) : 'weeks'
    }.`;
  } else if (shortened) {
    note = `${periodNames.baseline} is cut to its first ${weeksLabel(baseline.shortenedTo)} to match ${periodNames.current}.`;
  }

  return (
    <div className="bg-white rounded-lg border border-lavander shadow-sm p-3 h-full">
      <p className="text-sm font-medium text-deep-violet-blue mb-1">Comparison</p>

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
            <GrowthFigure label="Revenue" pct={revenuePct} />
            <GrowthFigure label="Volume" pct={volumePct} />
          </div>

          {aspPct !== null && (
            <div className="mt-2 border-t border-lavander pt-2 text-xs text-deep-violet-blue/70">
              <p className="flex items-baseline justify-between gap-2">
                <span className="font-medium text-deep-violet-blue">Avg price per unit</span>
                <Change pct={aspPct} />
              </p>
              {priceMix && (
                <dl className="mt-1 grid grid-cols-[auto_auto_1fr] items-baseline gap-x-2 gap-y-0.5 pl-2">
                  <dt>Price</dt>
                  <dd>
                    <Change pct={priceMix.pricePct} />
                  </dd>
                  <dd className="text-deep-violet-blue/60">
                    <span className="mr-1.5 text-deep-violet-blue/30" aria-hidden="true">|</span>
                    {priceMix.pricePct > 0 && 'same SKUs selling for more'}
                    {priceMix.pricePct < 0 && 'same SKUs selling for less'}
                  </dd>
                  <dt>Mix</dt>
                  <dd>
                    <Change pct={priceMix.mixPct} />
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
              tag={partial || shortened ? 'same weeks' : null}
              totals={baselineTotals}
              available={baselineAvailable}
            />
          </div>

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
