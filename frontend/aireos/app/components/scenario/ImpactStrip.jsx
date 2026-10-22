'use client';

import { Skeleton } from '@/components/ui/skeleton';

function formatUnits(value) {
  return Math.round(value).toLocaleString('en-US');
}

function formatDollars(value) {
  return `$${Math.round(value).toLocaleString('en-US')}`;
}

function signedPct(share) {
  return `${share < 0 ? '−' : '+'}${Math.abs(share * 100).toFixed(1)}%`;
}

function YearChips({ years, field }) {
  const shown = years.filter((year) => year[field] != null);
  if (!shown.length) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {shown.map((year) => (
        <span
          key={year.year}
          className="rounded-full bg-scenario-soft px-2 py-px text-[11px] font-semibold tabular-nums text-scenario-ink"
        >
          {signedPct(year[field])} on {year.year}
        </span>
      ))}
    </div>
  );
}

function Tile({ label, children }) {
  return (
    <div className="min-w-0 border-t border-lavander px-3 py-2 first:border-t-0 sm:border-l sm:border-t-0 sm:first:border-l-0">
      <dt className="text-xs font-medium text-deep-violet-blue">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

/**
 * What the switched-on building blocks add (above the chart), gains first:
 * volume added, revenue added, and how much of the gap to the Initial
 * Yearly Forecast they close. Each gain carries its share of the year(s)
 * it lands in, not of the months it touches, so a +10% month on a whole
 * year reads as the +0.8% it is. Numbers from pitchMetrics; `years` gives
 * the per-year shares.
 *
 * @param {{
 *   metrics: object,
 *   years: Array<{ year: string, unitsPct: number | null, revenuePct: number | null }>,
 *   loading: boolean,
 * }} props
 */
export default function ImpactStrip({ metrics, years, loading }) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" aria-busy="true">
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-[66px] rounded-lg bg-lavander/60" />
        ))}
      </div>
    );
  }

  if (!metrics.revenue.months.length) {
    return (
      <p className="rounded-lg border border-lavander bg-white px-3 py-2 text-xs text-deep-violet-blue/60">
        No building blocks or promotions fall inside the current filters.
      </p>
    );
  }

  const { units, revenue, gap } = metrics;
  const closed = gap.shortfall ? Math.min(1, gap.share ?? 0) : null;
  const left = gap.shortfall ? gap.shortfall * (1 - closed) : 0;

  return (
    <dl className="grid grid-cols-1 overflow-hidden rounded-lg border border-lavander bg-white text-deep-violet-blue sm:grid-cols-3">
      <Tile label="Volume added">
        <p className="font-serif text-xl leading-tight tabular-nums text-scenario-ink">
          +{formatUnits(units.added)} <span className="font-sans text-xs font-semibold">units</span>
        </p>
        <YearChips years={years} field="unitsPct" />
      </Tile>
      <Tile label="Revenue added">
        <p className="font-serif text-xl leading-tight tabular-nums text-scenario-ink">+{formatDollars(revenue.added)}</p>
        <YearChips years={years} field="revenuePct" />
      </Tile>
      <Tile label="Gap to target">
        {closed == null ? (
          <p className="font-serif text-xl leading-tight text-scenario-ink">On target</p>
        ) : (
          <>
            <p className="font-serif text-xl leading-tight tabular-nums text-scenario-ink">
              {Math.round(closed * 100)}% <span className="font-sans text-xs font-semibold">closed</span>
            </p>
            <div
              className="mt-1.5 h-2 overflow-hidden rounded-full bg-lavander"
              role="img"
              aria-label={`${Math.round(closed * 100)}% of the gap to the Initial Yearly Forecast closed`}
            >
              <div className="h-full rounded-full bg-scenario" style={{ width: `${Math.round(closed * 100)}%` }} />
            </div>
            <p className="mt-1 text-[11px] tabular-nums text-deep-violet-blue/60">
              {formatUnits(left)} units still to go
            </p>
          </>
        )}
      </Tile>
    </dl>
  );
}
