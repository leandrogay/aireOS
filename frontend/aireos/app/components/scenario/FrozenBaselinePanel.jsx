'use client';

import { useState } from 'react';
import Link from 'next/link';
import { LockKeyhole } from 'lucide-react';

import LineToggle from '@/components/ui/LineToggle';
import SelectDropdown from '@/components/ui/SelectDropdown';
import StatusPill from '@/components/ui/StatusPill';
import ScenarioAnchors from '@/components/scenario/ScenarioAnchors';
import { formatMonthLabel } from '@/app/utils/forecastView';
import { levelLabel, levelTone } from '@/app/utils/promoUpliftCalc';
import { breakdownMonths, sameMonthLastYear, scenarioAdjustments } from '@/app/utils/scenarioBreakdown';
import { bigChange, monthSplit } from '@/app/utils/scenarioTier0Split';

// The chart's shaded layers, bottom to top (scenarioComposition.js; the
// chart stacks them in this order). Tier 0 is its ordinary-month baseline
// (kept faint) and the promotions it carries from last year; official and
// scenario promotions are two shades of the promotion colour. What takes
// units away is hatched above the Simulated line, in its own colour.
export const COMPOSITION_LAYERS = [
  { key: 'baselineLayer', label: 'Baseline', color: '#3A4369', opacity: 0.08 },
  { key: 'carriedLayer', label: "Last year's promotions", color: '#3A4369', opacity: 0.22 },
  { key: 'officialLayer', label: 'Official promotions', color: '#D68B6D', opacity: 0.6 },
  { key: 'growthLayer', label: 'Growth', color: '#5E8C6A', opacity: 0.35 },
  { key: 'blocksLayer', label: 'Building blocks', color: '#8E7CC3', opacity: 0.35 },
  { key: 'promotionsLayer', label: 'Scenario promotions', color: '#D68B6D', opacity: 0.3 },
  { key: 'carriedDownLayer', label: "Last year's promotions (below an ordinary month)", color: '#3A4369', hatch: true },
  { key: 'officialDownLayer', label: 'Official promotions (below the anchor)', color: '#D68B6D', hatch: true },
  { key: 'decreaseLayer', label: 'Decreases', color: '#D23F74', hatch: true },
];

const LAYER_HINTS = {
  baselineLayer: 'An ordinary month at the anchor: Tier 0 with the promotions of the months it is built from taken out.',
  carriedLayer:
    "What last year's promotions (and the run-rate months') add to Tier 0, until a promotion is planned for the month.",
  officialLayer: 'Promotions planned on the Promotions page. In their months they replace last year’s.',
  growthLayer: 'Growth on Tier 0, set above.',
  blocksLayer: 'What building blocks add.',
  promotionsLayer: 'What the promotions planned here add.',
  carriedDownLayer:
    "Last year's promotions sold less than an ordinary month at the anchor: the hatched band above the line, up to the baseline.",
  officialDownLayer: 'An official promotion weaker than the anchor: the hatched band above the line.',
  decreaseLayer: 'Units a block or promotion takes away: the hatched band above the Simulated line.',
};

const NOTE_CLASS = 'mt-1.5 rounded-md border border-violet/40 bg-lavander/40 px-2.5 py-2 text-[11px] text-deep-violet-blue';

function units(value) {
  if (value == null || value === '') return 'Not available';
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

// A line under the figure it explains: "Mar 2027 · 20% Off".
function SubLine({ label, children }) {
  return (
    <p className="mt-0.5 flex justify-between gap-2 pl-2 text-[11px] text-deep-violet-blue/60">
      <span>{label}</span>
      <span className="text-right">{children}</span>
    </p>
  );
}

// Same month last year and the run-rate, each with the promotions that ran
// then, Tier 0, and its split into the baseline at the anchor and what the
// promotions carry (scenarioTier0Split.monthSplit).
function Tier0Card({ month, rows, tier0Split }) {
  const split = tier0Split.index ? monthSplit(rows, tier0Split.index, month) : null;
  const shown = split && split.splitRows > 0;
  const tier0 = split?.tier0 ?? rows.reduce((sum, row) => sum + (row.month_year === month ? Number(row.forecast_current) || 0 : 0), 0);

  return (
    <div className="rounded border border-lavander/80 bg-lavander/20 p-2.5">
      <p className="text-[10px] font-bold uppercase tracking-wide text-deep-violet-blue/55">How Tier 0 is built</p>
      <dl className="mt-1 text-xs">
        {shown ? (
          <>
            <Fact
              label={`Same month last year (${formatMonthLabel(sameMonthLastYear(month))})`}
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
          </>
        ) : null}
        <Fact
          label={shown ? 'Tier 0 = ½ last year + ½ run-rate' : `Tier 0 for ${formatMonthLabel(month)}`}
          value={units(tier0)}
          strong
        />
        {shown ? (
          <>
            <Fact label="Baseline at the anchor" value={units(split.baseline)} />
            <Fact label="Last year's promotions in it" value={signedUnits(split.carried)}>
              {split.carriedLevel ? (
                <p className="mt-0.5 flex justify-end">
                  <StatusPill tone={levelTone(split.carriedLevel)}>{levelLabel(split.carriedLevel)}</StatusPill>
                </p>
              ) : null}
            </Fact>
          </>
        ) : null}
      </dl>

      {tier0Split.error ? (
        <p className="mt-1.5 rounded-md border border-violet bg-lavander/50 px-2.5 py-2 text-xs text-deep-violet-blue" role="alert">
          Tier 0 could not be split into its baseline and promotions: {tier0Split.error}
        </p>
      ) : tier0Split.loading ? (
        <p className="mt-1 text-[11px] text-deep-violet-blue/60">Loading the baseline and promotions…</p>
      ) : null}

      {shown && split.official.plannedRows ? (
        <p className={NOTE_CLASS} role="status">
          Planned on the Promotions page: {promotionText(split.official.mechanics)}. It replaces last year&apos;s promotions
          {split.official.plannedRows < split.splitRows
            ? ` for ${split.official.plannedRows} of ${split.splitRows} SKUs`
            : ''}
          .
        </p>
      ) : null}
      {shown && split.notPlannedRows ? (
        <p className={NOTE_CLASS} role="status">
          <span className="font-semibold">Not planned yet.</span> {formatMonthLabel(month)} carries last year&apos;s
          promotions{split.notPlannedRows < split.splitRows ? ` for ${split.notPlannedRows} of ${split.splitRows} SKUs` : ''},
          not an ordinary month. Plan it on the{' '}
          <Link href="/promotions" className="font-medium text-scenario underline-offset-2 hover:underline">
            Promotions page
          </Link>{' '}
          or add a scenario promotion here.
        </p>
      ) : null}
      {shown && split.lastYear.rows < split.splitRows ? (
        <p className="mt-1 text-[11px] text-deep-violet-blue/60">
          {split.lastYear.rows
            ? `${split.splitRows - split.lastYear.rows} of ${split.splitRows} SKUs had no sales in ${formatMonthLabel(sameMonthLastYear(month))} and use the run-rate alone.`
            : `No sales in ${formatMonthLabel(sameMonthLastYear(month))}, so Tier 0 is the run-rate alone: flat, with no seasonality.`}
        </p>
      ) : null}
      {split?.unsplitRows ? (
        <p className="mt-1 text-[11px] text-deep-violet-blue/60">
          {split.unsplitRows} of {split.rowCount} SKUs could not be split (the forecast was rerun since), so they count as
          all baseline.
        </p>
      ) : null}
    </div>
  );
}

/**
 * The Scenario builder's Breakdown tab: the growth control (a slot, since
 * it saves through the page's blocks), then for one forecast month how Tier
 * 0 was built -- same month last year and the run-rate with the promotions
 * that ran in those months, split into the baseline at the anchor and what
 * those promotions carry -- and what the scenario changes on top. Tier 0 is
 * read-only; the totals cover every row in view. The anchors in the picked
 * month follow (ScenarioAnchors), filtered from the chart's customer and
 * SKU range.
 *
 * @param {{
 *   rows: object[],
 *   monthItems: Map<string, Array<{ source: string, deltaUnits: number }>>,
 *   tier0Split: { index: Map<string, object> | null, loading: boolean, error: string | null },
 *   anchors: { data: object | null, loading: boolean, error: string | null },
 *   customerName: string,
 *   skuRange: string,
 *   growthSection: import('react').ReactNode,
 *   compositionVisible: object,
 *   onToggleComposition: (key: string) => void,
 * }} props
 */
export default function FrozenBaselinePanel({
  rows,
  monthItems,
  tier0Split,
  anchors,
  customerName,
  skuRange,
  growthSection,
  compositionVisible,
  onToggleComposition,
}) {
  const months = breakdownMonths(rows);
  const [pickedMonth, setPickedMonth] = useState('');
  // The picked month, or the first one when it has left the view.
  const month = months.includes(pickedMonth) ? pickedMonth : months[0];

  const tier0 = month
    ? rows.reduce((sum, row) => sum + (row.month_year === month && row.forecast_current != null ? Number(row.forecast_current) : 0), 0)
    : 0;
  const adjustments = scenarioAdjustments(month ? monthItems.get(month) : []);
  const change = bigChange(tier0, adjustments.official + adjustments.promotions);

  return (
    <div className="space-y-3" aria-label="Forecast breakdown">
      <div className="flex items-center gap-1.5">
        <LockKeyhole className="size-3.5 text-deep-violet-blue/60" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-deep-violet-blue">Forecast breakdown</h2>
      </div>

      {growthSection}

      {month ? (
        <>
          <div className="flex items-center justify-end gap-2 border-t border-lavander pt-3">
            <SelectDropdown
              value={month}
              onChange={setPickedMonth}
              options={months.map((value) => ({ value, label: formatMonthLabel(value) }))}
              ariaLabel="Month to break down"
              look="compact"
              size="sm"
            />
          </div>

          <Tier0Card month={month} rows={rows} tier0Split={tier0Split} />

          <div className="rounded border border-scenario/20 bg-scenario-soft/40 p-2.5">
            <p className="text-[10px] font-bold uppercase tracking-wide text-scenario-ink/70">Your scenario</p>
            <dl className="mt-1 text-xs">
              <Fact label="Tier 0" value={units(tier0)} />
              {adjustments.official ? <Fact label="Official promotions" value={signedUnits(adjustments.official)} /> : null}
              <Fact label="Growth" value={signedUnits(adjustments.growth)} />
              <Fact label="Building blocks" value={signedUnits(adjustments.blocks)} />
              <Fact label="Scenario promotions" value={signedUnits(adjustments.promotions)} />
              <Fact label="Simulated" value={units(tier0 + adjustments.total)} strong />
            </dl>
            {change ? (
              <div className={NOTE_CLASS} role="status">
                <StatusPill tone="warning">Big change</StatusPill>
                <p className="mt-1">
                  The promotions planned take this month to Tier 0 × {change.ratio.toFixed(1)} ({signedUnits(change.change)}),
                  because they replace last year&apos;s. Check their uplifts on{' '}
                  <Link href="/promo-uplift-settings" className="font-medium text-scenario underline-offset-2 hover:underline">
                    Promotion uplift settings
                  </Link>
                  .
                </p>
              </div>
            ) : null}
          </div>

          <ScenarioAnchors anchors={anchors} month={month} customerName={customerName} skuRange={skuRange} />
        </>
      ) : (
        <p className="text-[11px] text-deep-violet-blue/60">No Tier 0 forecast in view to break down.</p>
      )}

      <LineToggle
        label="Shaded layers"
        visible={compositionVisible}
        onToggle={onToggleComposition}
        series={COMPOSITION_LAYERS.map((layer) => ({ key: layer.key, label: layer.label, color: layer.color, shape: 'square' }))}
        hints={LAYER_HINTS}
      />
    </div>
  );
}
