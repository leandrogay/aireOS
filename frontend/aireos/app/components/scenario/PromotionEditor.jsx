'use client';

import { cn } from '@/lib/utils';
import DateRangePicker from '@/components/ui/DateRangePicker';
import { formatMonthLabel, PROMO_OVERLAY_TYPES } from '@/app/utils/forecastView';
import { retailerLabel } from '@/app/utils/retailerLabel';
import { monthSpanLabel } from '@/app/utils/scenarioPitch';
import {
  MAX_OVERRIDE_PCT,
  MIN_OVERRIDE_PCT,
  effectiveUpliftRange,
  formatPct,
  formatPctRange,
  mechanicOptions,
  mechanicUpliftPct,
  lastDayOf,
  SIDE_OFFER_TYPE,
  sourceLabel,
  valuesAcrossSkus,
  voucherOption,
} from '@/app/utils/scenarioPromotions';
import MechanicLookupPopover from '@/components/scenario/MechanicLookupPopover';
import SkuRangePicker from '@/components/scenario/SkuRangePicker';

const fieldClass =
  'h-8 w-full rounded-md border border-violet bg-white px-2 text-xs text-deep-violet-blue disabled:opacity-50';
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
  if (anchor.source === 'default') return ' (all-customers default)';
  const mechanic = anchor.mechanic_label ? `, ${anchor.mechanic_label}` : '';
  return anchor.source === 'manual' ? ' (typed in on Promotion uplift settings)' : ` (usual mechanic${mechanic})`;
}

/**
 * Edit form for the selected draft promotion (Promotions Uplift design,
 * Section 6.1 step 6): mechanic from the uplift lookup, voucher Yes/No, an
 * optional override of the mechanic's uplift, the months and an explanation.
 *
 * Mechanic and voucher values come from `resolved` (the promotion customer's
 * GET /api/settings/promo-uplifts/resolved answer); choosing a mechanic only
 * sends its key, and the section copies the values in (withReferences).
 *
 * @param {{
 *   promotion: object,
 *   onUpdate: (changes: object) => void,
 *   resolved: object | undefined,
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
  resolved,
  customerOptions,
  skuRangeOptions,
  months,
  impact,
  stacked,
}) {
  const mechanics = mechanicOptions(resolved);
  const voucherRow = voucherOption(resolved);
  const skuRanges = promotion.skuRanges ?? [];
  // The ordinary month is the SKU range's anchor when one range is picked
  // and it differs from the customer's (backend resolve_uplifts
  // range_anchors; product_anchors for a promotion saved on one SKU before
  // ranges). With several ranges the customer's is shown, noting that some
  // ranges have their own.
  let ownAnchorPct;
  if (skuRanges.length === 1) ownAnchorPct = resolved?.range_anchors?.[skuRanges[0]];
  else if (!skuRanges.length && promotion.sku) ownAnchorPct = resolved?.product_anchors?.[promotion.sku];
  const anchorVaries = skuRanges.length > 1 && skuRanges.some((name) => resolved?.range_anchors?.[name] != null);
  const anchor = resolved?.anchor ? { ...resolved.anchor, anchor_pct: ownAnchorPct ?? resolved.anchor.anchor_pct } : null;
  // One SKU (older promotions) or one range has a single value; otherwise
  // the value can differ by SKU range.
  const singleValue = skuRanges.length === 1 || (!skuRanges.length && Boolean(promotion.sku));
  const overridden = promotion.overrideUpliftPct != null;
  const sliderValue = mechanicUpliftPct(promotion);
  const range = MAX_OVERRIDE_PCT - MIN_OVERRIDE_PCT;
  const markerLeft = `${((promotion.referenceUpliftPct - MIN_OVERRIDE_PCT) / range) * 100}%`;
  const bySkuCount = Object.keys(promotion.referenceBySku ?? {}).length;

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

      <div>
        <label className={labelClass} htmlFor="promo-customer">Customer</label>
        <select
          id="promo-customer"
          value={promotion.customer}
          onChange={(event) => onUpdate({ customer: event.target.value })}
          className={fieldClass}
        >
          {customerOptions.map((name) => (
            <option key={name} value={name}>{retailerLabel(name)}</option>
          ))}
        </select>
      </div>

      <SkuRangePicker
        id="promo-sku-ranges"
        label="SKU ranges"
        values={skuRanges}
        options={skuRangeOptions}
        legacySku={promotion.sku}
        legacyNoun="promotion"
        // Ticking ranges moves an older one-SKU promotion onto them.
        onChange={(next) => onUpdate({ skuRanges: next, sku: next.length ? '' : promotion.sku })}
      />

      <div>
        <label className={labelClass} htmlFor="promo-type">Promotion type</label>
        <select
          id="promo-type"
          value={promotion.promoType}
          onChange={(event) => onUpdate({ promoType: event.target.value })}
          className={fieldClass}
        >
          {PROMO_OVERLAY_TYPES.map((type) => (
            <option key={type.value} value={type.value}>{type.label}</option>
          ))}
        </select>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <label className={labelClass} htmlFor="promo-mechanic">Mechanic</label>
          <MechanicLookupPopover uplifts={resolved?.uplifts ?? []} anchorPct={anchor?.anchor_pct ?? null} />
        </div>
        <select
          id="promo-mechanic"
          value={promotion.mechanicKey}
          onChange={(event) => onUpdate({ mechanicKey: event.target.value, overrideUpliftPct: null })}
          className={fieldClass}
        >
          {mechanics.map((row) => (
            <option key={row.mechanic_key} value={row.mechanic_key}>
              {row.mechanic_label} · {optionValue(row)}
              {!singleValue && new Set(optionValues(row)).size > 1 ? ' by SKU range' : ''} ({sourceLabel(row.source)})
            </option>
          ))}
        </select>
        {anchor ? (
          <p className="mt-0.5 text-[11px] text-deep-violet-blue/50">
            Ordinary month for {retailerLabel(promotion.customer)}: {anchor.anchor_pct}% off
            {anchorNote(anchor, ownAnchorPct != null, anchorVaries)}
          </p>
        ) : null}
      </div>

      <div>
        <span className={labelClass}>
          Voucher{voucherRow ? ` · ${singleValue ? formatPct(promotion.voucherUpliftPct) : formatPctRange(optionValues(voucherRow))}` : ''}
        </span>
        <div className="flex gap-1" role="group" aria-label="Voucher">
          {[
            { value: true, label: 'Yes' },
            { value: false, label: 'No' },
          ].map((option) => (
            <button
              key={option.label}
              type="button"
              aria-pressed={promotion.voucher === option.value}
              onClick={() => onUpdate({ voucher: option.value })}
              className={
                promotion.voucher === option.value
                  ? 'h-7 flex-1 rounded-md border border-deep-violet-blue bg-deep-violet-blue text-xs font-medium text-white'
                  : 'h-7 flex-1 rounded-md border border-lavander bg-white text-xs text-deep-violet-blue hover:bg-cream'
              }
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <label className={labelClass} htmlFor="promo-uplift">Mechanic uplift</label>
          <output htmlFor="promo-uplift" className="font-serif text-lg text-scenario">
            {formatPct(sliderValue)}
          </output>
        </div>
        <div className="relative">
          <input
            id="promo-uplift"
            type="range"
            min={MIN_OVERRIDE_PCT}
            max={MAX_OVERRIDE_PCT}
            step={1}
            value={sliderValue}
            onChange={(event) => {
              const value = Number(event.target.value);
              onUpdate({ overrideUpliftPct: value === promotion.referenceUpliftPct ? null : value });
            }}
            className="w-full accent-scenario"
          />
          <span
            className="pointer-events-none absolute -bottom-1.5 h-2 w-0.5 -translate-x-1/2 bg-deep-violet-blue/50"
            style={{ left: markerLeft }}
            title={`Reference ${formatPct(promotion.referenceUpliftPct)}`}
            aria-hidden="true"
          />
        </div>
        {overridden ? (
          <p className="text-[11px] text-deep-violet-blue/70">
            Adjusted from {formatPct(promotion.referenceUpliftPct)} ·{' '}
            <button
              type="button"
              onClick={() => onUpdate({ overrideUpliftPct: null })}
              className="font-medium text-scenario underline-offset-2 hover:underline"
            >
              Reset
            </button>
          </p>
        ) : (
          <p className="text-[11px] text-deep-violet-blue/50">
            Reference value ({sourceLabel(promotion.referenceSource)}
            {bySkuCount ? `; ${bySkuCount} SKU${bySkuCount === 1 ? ' has' : 's have'} its own value` : ''}). Move the
            slider to override it for this promotion only.
          </p>
        )}
        <p className="text-[11px] text-deep-violet-blue/50">
          The forecast already reflects an ordinary month
          {anchor ? ` for ${retailerLabel(promotion.customer)} (usual: ${anchor.anchor_pct}% off)` : ''}, so this is
          the change on top of that, not the promotion&apos;s whole effect. Planning the usual discount adds about 0%.
        </p>
        <p className="text-[11px] text-deep-violet-blue/70">
          Total uplift: <b>{formatPctRange(effectiveUpliftRange(promotion))}</b>
          {promotion.voucher ? ' (mechanic + voucher)' : ''}
        </p>
      </div>

      {/* Side offers run weekly, on exact days, so they get dates instead of
          months; dayShare counts the days in each month. */}
      {promotion.promoType === SIDE_OFFER_TYPE ? (
        <div>
          <div className="grid grid-cols-2 gap-2">
            <DateRangePicker
              className="contents"
              start={promotion.startDate}
              end={promotion.endDate}
              onStartChange={(value) => onUpdate({ startDate: value })}
              onEndChange={(value) => onUpdate({ endDate: value })}
              startLabel="Runs from"
              endLabel="Until"
              minDate={months[0]}
              maxDate={months.length ? lastDayOf(months[months.length - 1]) : undefined}
              labelClassName={labelClass}
            />
          </div>
          <p className="mt-1 text-[11px] text-deep-violet-blue/50">
            A side offer adds its uplift for the days it runs: 1-10 Nov adds a third of it to November.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelClass} htmlFor="promo-start">Active from</label>
            <select
              id="promo-start"
              value={promotion.startMonth}
              onChange={(event) => onUpdate({ startMonth: event.target.value })}
              className={fieldClass}
            >
              {months.map((month) => (
                <option key={month} value={month}>{formatMonthLabel(month)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="promo-end">Until</label>
            <select
              id="promo-end"
              value={promotion.endMonth}
              onChange={(event) => onUpdate({ endMonth: event.target.value })}
              className={fieldClass}
            >
              {months.map((month) => (
                <option key={month} value={month}>{formatMonthLabel(month)}</option>
              ))}
            </select>
          </div>
        </div>
      )}

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
            This promotion changes {retailerLabel(promotion.customer)} sell-out by{' '}
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
