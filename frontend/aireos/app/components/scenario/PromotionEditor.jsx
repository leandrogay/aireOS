'use client';

import { cn } from '@/lib/utils';
import { levelLabel } from '@/app/utils/promoUpliftCalc';
import { customerLabel, customersLabel } from '@/app/utils/retailerLabel';
import { withPairSwitched } from '@/app/utils/scenarioEngine';
import { monthSpanLabel } from '@/app/utils/scenarioPitch';
import { liveUpliftValues, weakestLevel } from '@/app/utils/scenarioLiveUplifts';
import {
  formatPctRange,
  mechanicOptions,
  promotionCustomers,
  sourceLabel,
  valuesAcrossSkus,
  voucherUpliftPct,
} from '@/app/utils/scenarioPromotions';
import ItemPairs from '@/components/scenario/ItemPairs';
import PromotionScopeFields from '@/components/scenario/PromotionScopeFields';
import PromotionDateFields from '@/components/scenario/PromotionDateFields';
import PromotionVoucherFields from '@/components/scenario/PromotionVoucherFields';
import PromotionUpliftControl from '@/components/scenario/PromotionUpliftControl';
import { promotionUpliftControl } from '@/app/utils/promotionUpliftControl';
import { promotionUpliftDetails } from '@/app/utils/promotionUpliftDetails';

const labelClass = 'mb-0.5 block text-[11px] text-deep-violet-blue/70';

function signedUnits(value) {
  const rounded = Math.round(value);
  return `${rounded < 0 ? '−' : '+'}${Math.abs(rounded).toLocaleString('en-US')}`;
}

// Where the ordinary month comes from (backend promo_uplifts anchors). A
// product whose range has its own anchor only carries its discount; several
// picked ranges may each have their own.
function anchorNote(anchor, ownRange, varies) {
  if (ownRange) return " (this SKU range's anchor)";
  if (varies) return ' (customer anchor; some picked SKU ranges have their own)';
  if (anchor.source === 'default') return ' (fallback anchor)';
  const mechanic = anchor.mechanic_label ? `, ${anchor.mechanic_label}` : '';
  return anchor.source === 'manual' ? ' (overwritten on Promotion uplift settings)' : ` (usual mechanic${mechanic})`;
}

/**
 * Edit form for the selected draft promotion (Promotions Uplift design,
 * Section 6.1 step 6): mechanic from the uplift lookup, voucher Yes/No, an
 * optional override of the mechanic's uplift, the months and an explanation.
 *
 * The mechanic's uplift is the one worked out now (`liveIndex`,
 * scenarioLiveUplifts), with its level and an 'i' card; the mechanic list,
 * anchors and vouchers come from `upliftsByCustomer` (each customer's
 * GET /api/settings/promo-uplifts/resolved answer; the mechanics are the
 * same for every customer, so the first one's lists them). A promotion can
 * cover several customers: each takes its own worked-out uplift, the slider
 * shows their spread and moving it explicitly overrides all of them. Choosing
 * a mechanic only sends its key, and the section copies the values in
 * (withReferences). The voucher's value can be edited for this scenario (one
 * value for every customer), and Reset goes back to each one's setting.
 * Each customer x SKU range can be switched off on its own (`pairs`).
 *
 * @param {{
 *   promotion: object,
 *   onUpdate: (changes: object) => void,
 *   upliftsByCustomer: Record<string, object>,
 *   pairs: ReturnType<typeof import('@/app/utils/scenarioEngine').itemPairs>,
 *   liveIndex?: Map<string, object[]> | null,
 *   liveLoading?: boolean,
 *   plan?: 'scenario' | 'budget',
 *   customerOptions: string[],
 *   skuRangeOptions: string[],
 *   months: string[],
 *   impact: { deltaUnits: number, months: string[] } | null | undefined,
 *   stacked: { count: number, months: string[] },
 * }} props
 */
export default function PromotionEditor({
  promotion,
  onUpdate,
  upliftsByCustomer,
  pairs,
  liveIndex = null,
  liveLoading = false,
  plan = 'scenario',
  customerOptions,
  skuRangeOptions,
  months,
  impact,
  stacked,
}) {
  const customers = promotionCustomers(promotion);
  const oneCustomer = customers.length === 1 ? customers[0] : null;
  // Mechanics are the same for every customer: the first one's set lists them.
  const resolved = upliftsByCustomer?.[customers[0]];
  const mechanics = mechanicOptions(resolved);
  const skuRanges = promotion.skuRanges ?? [];
  // Each customer's ordinary month: the SKU range's anchor when one range is
  // picked and it differs from the customer's (backend resolve_uplifts
  // range_anchors; product_anchors for a promotion saved on one SKU before
  // ranges). With several ranges the customer's is shown, noting that some
  // ranges have their own.
  const anchors = customers
    .map((customer) => {
      const set = upliftsByCustomer?.[customer];
      if (!set?.anchor) return null;
      let own;
      if (skuRanges.length === 1) own = set.range_anchors?.[skuRanges[0]];
      else if (!skuRanges.length && promotion.sku) own = set.product_anchors?.[promotion.sku];
      const varies = skuRanges.length > 1 && skuRanges.some((name) => set.range_anchors?.[name] != null);
      return { customer, anchor: { ...set.anchor, anchor_pct: own ?? set.anchor.anchor_pct }, own: own != null, varies };
    })
    .filter(Boolean);
  const anchor = oneCustomer ? anchors[0]?.anchor ?? null : null;
  // One SKU (older promotions) or one range has a single value; otherwise
  // the value can differ by SKU range.
  const singleValue = skuRanges.length === 1 || (!skuRanges.length && Boolean(promotion.sku));
  // The engine's whole mechanic range, with the override removed, is the
  // expected value. A per-SKU spread is never presented as one applied %.
  const upliftDetails = promotionUpliftDetails(promotion, { liveIndex, upliftsByCustomer });
  const upliftControl = promotionUpliftControl(
    upliftDetails.map((row) => row.expectedPct), promotion.overrideUpliftPct,
  );
  // What each mechanic is worth now for this promotion: its worked-out
  // values and their weakest level, else the resolved settings.
  function liveOption(row) {
    if (!liveIndex) return null;
    const values = customers.flatMap((customer) =>
      liveUpliftValues(liveIndex, { ...promotion, customer, mechanicKey: row.mechanic_key })
    );
    return values.length ? values : null;
  }

  function optionParts(row) {
    const live = liveOption(row);
    if (live) {
      return {
        key: row.mechanic_key,
        label: row.mechanic_label,
        uplift: formatPctRange(live.map((item) => item.upliftPct)),
        basis: levelLabel(weakestLevel(live)),
      };
    }
    const varies = !singleValue && new Set(optionValues(row)).size > 1 ? ' by SKU range' : '';
    return { key: row.mechanic_key, label: row.mechanic_label, uplift: `${optionValue(row)}${varies}`, basis: sourceLabel(row.source) };
  }

  // What each mechanic is worth for this promotion's SKU ranges.
  function optionValues(row) {
    if (!skuRanges.length && promotion.sku) {
      return [resolved?.product_uplifts?.[promotion.sku]?.[row.mechanic_key] ?? row.uplift_pct];
    }
    return valuesAcrossSkus(resolved, row, skuRanges);
  }

  function optionValue(row) {
    return formatPctRange(optionValues(row));
  }

  return (
    <div className="space-y-2.5 border-t border-lavander pt-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-deep-violet-blue/60">
        Edit selected promotion
      </p>

      <PromotionScopeFields
        promotion={promotion}
        onUpdate={onUpdate}
        customerOptions={customerOptions}
        skuRangeOptions={skuRangeOptions}
        mechanics={mechanics.map(optionParts)}
        anchorPct={anchor?.anchor_pct ?? null}
      >
        <PromotionUpliftControl key={`${promotion.id}|${promotion.mechanicKey}`}
          state={upliftControl} mechanic={promotion.mechanicLabel} rows={upliftDetails} loading={liveLoading} plan={plan}
          disabled={!promotion.mechanicKey} onOverride={(overrideUpliftPct) => onUpdate({ overrideUpliftPct })} />
        {anchor ? (
          <p className="mt-0.5 text-[11px] text-deep-violet-blue/50">
            {plan === 'budget' ? 'Current ordinary-month setting for ' : 'Ordinary month for '}
            {customerLabel(oneCustomer)}: {anchor.anchor_pct}% off
            {anchorNote(anchor, anchors[0].own, anchors[0].varies)}
          </p>
        ) : anchors.length ? (
          <p className="mt-0.5 text-[11px] text-deep-violet-blue/50">
            {plan === 'budget' ? 'Current ordinary-month settings: ' : 'Ordinary month: '}
            {anchors.map((item) => `${customerLabel(item.customer)} ${item.anchor.anchor_pct}% off`).join(' · ')}
          </p>
        ) : null}
      </PromotionScopeFields>

      <PromotionVoucherFields key={promotion.id} promotion={promotion} upliftsByCustomer={upliftsByCustomer} onUpdate={onUpdate} />

      <p className="border-t border-lavander pt-2 text-xs text-deep-violet-blue/70">
        Total uplift used: <b>{formatPctRange(upliftDetails.map((row) => row.appliedPct + voucherUpliftPct(promotion, row.customer, row.product)))}</b>
        {promotion.voucher ? ' (mechanic + voucher)' : ' (mechanic only)'}
      </p>

      <PromotionDateFields promotion={promotion} months={months} onUpdate={onUpdate} />

      <div>
        <label className={labelClass} htmlFor="promo-explanation">
          Explanation <span className="text-deep-violet-blue/50">(optional · shown in the pitch summary)</span>
        </label>
        <textarea
          id="promo-explanation"
          rows={3}
          value={promotion.explanation}
          placeholder="Why this promotion, and what's behind the uplift."
          onChange={(event) => onUpdate({ explanation: event.target.value })}
          className="w-full rounded-md border border-violet bg-white px-2 py-1.5 text-xs text-deep-violet-blue"
        />
      </div>

      {/* Switching a pair off is an edit like any other: Save keeps it. */}
      <ItemPairs
        pairs={pairs}
        active={promotion.isActive}
        onToggle={(customer, skuRange, on) =>
          onUpdate({ excludedPairs: withPairSwitched(promotion, customer, skuRange, on) })
        }
      />

      {/* Same rule as BlockEditor: scenario colour only when the note gives
          simulated numbers, otherwise the neutral information style. */}
      <p
        className={cn(
          'rounded-md px-2.5 py-2 text-xs',
          impact ? 'bg-scenario-soft text-scenario-ink' : 'border border-violet bg-lavander/50 text-deep-violet-blue'
        )}
      >
        {impact ? (
          <>
            This promotion changes {customersLabel(promotion.customers)} sell-out by{' '}
            <b>{signedUnits(impact.deltaUnits)} units</b> across{' '}
            {monthSpanLabel(impact.months)}.
          </>
        ) : (
          'Not in current chart view: change the filters to this customer and SKU range to see its impact.'
        )}
      </p>
      {stacked.count ? (
        <p className="text-[11px] text-deep-violet-blue/70">
          Added on top of the promotion already in the forecast for {stacked.count} SKU-
          {stacked.count === 1 ? 'month' : 'months'} ({monthSpanLabel(stacked.months)}). Switch to Simulate New
          Promotions above the chart to plan from the forecast without it.
        </p>
      ) : null}
    </div>
  );
}
