'use client';

import Link from 'next/link';

import StatusPill from '@/components/ui/StatusPill';
import { formatMonthLabel } from '@/app/utils/forecastView';
import { levelLabel, levelTone } from '@/app/utils/promoUpliftCalc';
import { sameMonthLastYear } from '@/app/utils/scenarioBreakdown';
import { monthSplit } from '@/app/utils/scenarioTier0Split';

const NOTE_CLASS = 'rounded-md border border-violet/40 bg-lavander/40 px-2.5 py-2 text-[11px] text-deep-violet-blue';
const LINK_CLASS = 'font-medium text-scenario underline-offset-2 hover:underline';

function units(value) {
  return Math.round(Number(value) || 0).toLocaleString('en-US');
}

function signedUnits(value) {
  const number = Math.round(Number(value) || 0);
  return `${number < 0 ? '−' : '+'}${Math.abs(number).toLocaleString('en-US')}`;
}

function spanLabel(months) {
  if (!months.length) return 'the latest 3 months';
  const first = formatMonthLabel(months[0]);
  const last = formatMonthLabel(months[months.length - 1]);
  return first === last ? first : `${first} – ${last}`;
}

function promotionText(mechanics) {
  return mechanics.length ? mechanics.join(', ') : 'No promotion recorded';
}

function Fact({ label, value, strong = false, children }) {
  return (
    <div className="border-b border-lavander/70 py-1.5 last:border-0">
      <div className="flex items-center justify-between gap-3">
        <dt className={strong ? 'font-semibold text-deep-violet-blue' : 'text-deep-violet-blue/65'}>{label}</dt>
        <dd className="font-semibold tabular-nums text-deep-violet-blue">{value}</dd>
      </div>
      {children}
    </div>
  );
}

// A line under the figure it explains: "Mar 2027 · 420 · 20% Off".
function SubLine({ label, children }) {
  return (
    <p className="mt-0.5 flex justify-between gap-2 pl-2 text-[11px] text-deep-violet-blue/60">
      <span>{label}</span>
      <span className="text-right">{children}</span>
    </p>
  );
}

/**
 * One month of the Monthly plan opened: how its Tier 0 is built (same month
 * last year and the run-rate months, each with the promotions that ran
 * then), Tier 0's split into the baseline at the anchor and what those
 * promotions carry (scenarioTier0Split.monthSplit), the anchor in effect and
 * a warning when the promotions planned move it by more than 35%. What is
 * planned for the month is on the row itself (its status pill and the
 * Promotions column).
 *
 * @param {{
 *   month: string,
 *   rows: object[],
 *   tier0Split: { index: Map<string, object> | null, loading: boolean, error: string | null },
 *   anchor: string | null,
 *   change: { ratio: number, change: number } | null,
 * }} props
 */
export default function Tier0Details({ month, rows, tier0Split, anchor, change }) {
  const split = tier0Split.index ? monthSplit(rows, tier0Split.index, month) : null;
  const shown = split && split.splitRows > 0;
  const lastYearMonth = sameMonthLastYear(month);

  return (
    <div className="grid gap-3 text-xs text-deep-violet-blue md:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wide text-deep-violet-blue/55">How Tier 0 is built</p>
        {tier0Split.error ? (
          <p className="mt-1 rounded-md border border-violet bg-lavander/50 px-2.5 py-2 text-xs" role="alert">
            Tier 0 could not be split into its baseline and promotions: {tier0Split.error}
          </p>
        ) : tier0Split.loading ? (
          <p className="mt-1 text-[11px] text-deep-violet-blue/60">Loading the baseline and promotions…</p>
        ) : shown ? (
          <dl className="mt-1">
            <Fact
              label={`Same month last year (${formatMonthLabel(lastYearMonth)})`}
              value={split.lastYear.rows ? units(split.lastYear.units) : 'No sales'}
            >
              {split.lastYear.rows ? <SubLine label="Promotions then">{promotionText(split.lastYear.mechanics)}</SubLine> : null}
            </Fact>
            <Fact label={`Run-rate (average of ${spanLabel(split.recent.map((item) => item.month))})`} value={units(split.runRate)}>
              {split.recent.map((item) => (
                <SubLine key={item.month} label={`${formatMonthLabel(item.month)} · ${units(item.units)}`}>
                  {promotionText(item.mechanics)}
                </SubLine>
              ))}
            </Fact>
            <Fact label="Tier 0 = ½ last year + ½ run-rate" value={units(split.tier0)} strong />
            <Fact label="Baseline at the anchor" value={units(split.baseline)} />
            <Fact label="Last year's promotions in it" value={signedUnits(split.carried)}>
              {split.carriedLevel ? (
                <p className="mt-0.5 flex justify-end">
                  <StatusPill tone={levelTone(split.carriedLevel)}>{levelLabel(split.carriedLevel)}</StatusPill>
                </p>
              ) : null}
            </Fact>
          </dl>
        ) : (
          <p className="mt-1 text-[11px] text-deep-violet-blue/60">No split of Tier 0 for this month.</p>
        )}
      </div>

      <div className="space-y-1.5">
        {anchor ? (
          <p className="text-[11px] text-deep-violet-blue/70">
            <span className="font-semibold text-deep-violet-blue">Anchor:</span> {anchor}
          </p>
        ) : null}
        {change ? (
          <div className={NOTE_CLASS} role="status">
            <StatusPill tone="warning">Big change</StatusPill>
            <p className="mt-1">
              The promotions planned take this month to Tier 0 × {change.ratio.toFixed(1)} ({signedUnits(change.change)}),
              because they replace last year&apos;s. Check their uplifts on{' '}
              <Link href="/promo-uplift-settings" className={LINK_CLASS}>
                Promotion uplift settings
              </Link>
              .
            </p>
          </div>
        ) : null}
        {shown && split.lastYear.rows < split.splitRows ? (
          <p className="text-[11px] text-deep-violet-blue/60">
            {split.lastYear.rows
              ? `${split.splitRows - split.lastYear.rows} of ${split.splitRows} SKUs had no sales in ${formatMonthLabel(lastYearMonth)} and use the run-rate alone.`
              : `No sales in ${formatMonthLabel(lastYearMonth)}, so Tier 0 is the run-rate alone: flat, with no seasonality.`}
          </p>
        ) : null}
        {split?.unsplitRows ? (
          <p className="text-[11px] text-deep-violet-blue/60">
            {split.unsplitRows} of {split.rowCount} SKUs could not be split (the forecast was rerun since), so they count as
            all baseline.
          </p>
        ) : null}
      </div>
    </div>
  );
}
