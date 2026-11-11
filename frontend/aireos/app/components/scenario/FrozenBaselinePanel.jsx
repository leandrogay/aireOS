'use client';

import { useState } from 'react';
import { LockKeyhole } from 'lucide-react';

import { cn } from '@/lib/utils';
import LineToggle from '@/components/ui/LineToggle';
import SelectDropdown from '@/components/ui/SelectDropdown';
import ScenarioAnchors from '@/components/scenario/ScenarioAnchors';
import { formatMonthLabel } from '@/app/utils/forecastView';
import {
  breakdownMonths,
  discountSourceLabel,
  scenarioAdjustments,
  tier0Breakdown,
} from '@/app/utils/scenarioBreakdown';

// The chart's shaded layers, bottom to top (scenarioComposition.js; the
// chart stacks them in this order). Tier 0 is kept faint so what the
// scenario adds stands out; decreases are hatched in the Simulated colour.
// Official promotions get their own shade once Tier 0 can be split into its
// ordinary-month baseline and the promotions in it (Phase 5).
export const COMPOSITION_LAYERS = [
  { key: 'tier0Layer', label: 'Tier 0', color: '#3A4369', opacity: 0.08 },
  { key: 'growthLayer', label: 'Growth', color: '#5E8C6A', opacity: 0.35 },
  { key: 'blocksLayer', label: 'Building blocks', color: '#8E7CC3', opacity: 0.35 },
  { key: 'promotionsLayer', label: 'Scenario promotions', color: '#D68B6D', opacity: 0.35 },
  { key: 'decreaseLayer', label: 'Decreases', color: '#D23F74', hatch: true },
];

const LAYER_HINTS = {
  tier0Layer:
    'The Tier 0 forecast, which still includes the promotions of the months it is built from. It cannot be edited here.',
  growthLayer: 'Growth on Tier 0, set above.',
  blocksLayer: 'What building blocks add.',
  promotionsLayer: 'What the promotions planned here add.',
  decreaseLayer: 'Units a block or promotion takes away: the hatched band above the Simulated line.',
};

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

function StatusBadge({ children, tone = 'muted' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold',
        tone === 'frozen' && 'bg-lavander text-deep-violet-blue',
        tone === 'fallback' && 'bg-amber-50 text-amber-800',
        tone === 'muted' && 'bg-cream text-deep-violet-blue/60'
      )}
    >
      {children}
    </span>
  );
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

// A discount under the figure it shaped: "20% off · Measured".
function Discount({ label, discount }) {
  return (
    <p className="mt-0.5 flex justify-between gap-2 pl-2 text-[11px] text-deep-violet-blue/60">
      <span>{label}</span>
      <span>
        {discount?.mechanic ?? 'No discount recorded'}
        {discount?.source ? ` · ${discountSourceLabel(discount.source)}` : ''}
      </span>
    </p>
  );
}

// Same month last year, the run-rate and the discounts that ran in those
// months, side by side: Tier 0 is built from exactly these.
function Tier0Card({ breakdown, bakedIn, rangePicked }) {
  const discountsShown = rangePicked && bakedIn;
  return (
    <div className="rounded border border-lavander/80 bg-lavander/20 p-2.5">
      <p className="text-[10px] font-bold uppercase tracking-wide text-deep-violet-blue/55">How Tier 0 is built</p>
      <dl className="mt-1 text-xs">
        {breakdown.available ? (
          <>
            <Fact label={`Same month last year (${formatMonthLabel(breakdown.lastYearMonth)})`} value={units(breakdown.lastYear)}>
              {discountsShown ? <Discount label="Discount then" discount={bakedIn.same_month_last_year} /> : null}
            </Fact>
            <Fact label={`Run-rate (average of ${spanLabel(breakdown.recentMonths)})`} value={units(breakdown.runRate)}>
              {discountsShown
                ? (bakedIn.recent_months ?? []).map((item) => (
                    <Discount key={item.month} label={formatMonthLabel(item.month)} discount={item} />
                  ))
                : null}
            </Fact>
          </>
        ) : null}
        <Fact
          label={breakdown.available ? `Tier 0 = ½ last year + ½ run-rate` : `Tier 0 for ${formatMonthLabel(breakdown.month)}`}
          value={units(breakdown.tier0)}
          strong
        />
      </dl>

      {breakdown.available && breakdown.runRateOnlyRows ? (
        <p className="mt-1 text-[11px] text-amber-800">
          {breakdown.runRateOnlyRows === breakdown.rowCount
            ? `No sales in ${formatMonthLabel(breakdown.lastYearMonth)}, so Tier 0 is the run-rate alone: flat, with no seasonality.`
            : `${breakdown.runRateOnlyRows} of ${breakdown.rowCount} SKUs had no sales in ${formatMonthLabel(breakdown.lastYearMonth)} and use the run-rate alone.`}
        </p>
      ) : null}
      {!breakdown.available ? (
        <p className="mt-1 text-[11px] text-deep-violet-blue/60">
          Last year and run-rate figures appear once the forecast run saves them.
        </p>
      ) : null}
      {breakdown.available && !discountsShown ? (
        <p className="mt-1 text-[11px] text-deep-violet-blue/60">
          {rangePicked
            ? 'The discounts behind these months are not available yet.'
            : 'Pick one customer and SKU range to see the discounts behind these months.'}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The Scenario builder's Breakdown tab: the growth control (a slot, since
 * it saves through the page's blocks), then for one forecast month how Tier
 * 0 was built -- same month last year and the run-rate with the discounts
 * that ran in those months -- and what the scenario adds on top. Tier 0 is
 * read-only; the totals cover every row in view (scenarioBreakdown.js).
 * Discounts are per customer x SKU range (as promo anchors are stored), so
 * they show once both are picked (rangePicked). The anchors in the picked
 * month follow (ScenarioAnchors), filtered from the chart's customer and
 * SKU range.
 *
 * @param {{
 *   rows: object[],
 *   monthItems: Map<string, Array<{ source: string, deltaUnits: number }>>,
 *   bakedIn: object | null,
 *   rangePicked: boolean,
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
  bakedIn,
  rangePicked,
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

  const breakdown = month ? tier0Breakdown(rows, month) : null;
  const adjustments = scenarioAdjustments(month ? monthItems.get(month) : []);
  const isFrozen = rows.some((row) => row.tier0_latest_month);

  return (
    <div className="space-y-3" aria-label="Forecast breakdown">
      <div className="flex items-center gap-1.5">
        <LockKeyhole className="size-3.5 text-deep-violet-blue/60" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-deep-violet-blue">Forecast breakdown</h2>
      </div>

      {growthSection}

      {breakdown ? (
        <>
          <div className="flex items-center justify-between gap-2 border-t border-lavander pt-3">
            <div className="flex flex-wrap gap-1.5">
              <StatusBadge tone={isFrozen ? 'frozen' : 'fallback'}>{isFrozen ? 'Tier 0 frozen' : 'Tier 0 fallback'}</StatusBadge>
              {bakedIn ? (
                <StatusBadge tone={bakedIn.frozen ? 'frozen' : 'fallback'}>
                  {bakedIn.frozen ? 'Discounts frozen' : 'Discounts not frozen yet'}
                </StatusBadge>
              ) : null}
            </div>
            <SelectDropdown
              value={month}
              onChange={setPickedMonth}
              options={months.map((value) => ({ value, label: formatMonthLabel(value) }))}
              ariaLabel="Month to break down"
              look="compact"
              size="sm"
            />
          </div>

          <Tier0Card breakdown={breakdown} bakedIn={bakedIn} rangePicked={rangePicked} />

          <div className="rounded border border-scenario/20 bg-scenario-soft/40 p-2.5">
            <p className="text-[10px] font-bold uppercase tracking-wide text-scenario-ink/70">Your scenario</p>
            <dl className="mt-1 text-xs">
              <Fact label="Tier 0" value={units(breakdown.tier0)} />
              <Fact label="Growth" value={signedUnits(adjustments.growth)} />
              <Fact label="Building blocks" value={signedUnits(adjustments.blocks)} />
              <Fact label="Scenario promotions" value={signedUnits(adjustments.promotions)} />
              <Fact label="Simulated" value={units(breakdown.tier0 + adjustments.total)} strong />
            </dl>
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
