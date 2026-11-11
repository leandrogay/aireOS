'use client';

import { useState } from 'react';

import { cn } from '@/lib/utils';
import DateRangePicker from '@/components/ui/DateRangePicker';
import InfoTooltip from '@/components/ui/InfoTooltip';
import StatusPill from '@/components/ui/StatusPill';
import { formatMonthLabel, PROMO_OVERLAY_TYPES } from '@/app/utils/forecastView';
import { anchorLine, explanationLines, levelLabel, levelTone, monthText } from '@/app/utils/promoUpliftCalc';
import { customerLabel } from '@/app/utils/retailerLabel';
import { monthSpanLabel } from '@/app/utils/scenarioPitch';
import { liveReferences, liveUpliftValues, weakestLevel } from '@/app/utils/scenarioLiveUplifts';
import {
  MAX_OVERRIDE_PCT,
  MIN_OVERRIDE_PCT,
  effectiveUpliftRange,
  formatPct,
  formatPctRange,
  mechanicOptions,
  lastDayOf,
  SIDE_OFFER_TYPE,
  sourceLabel,
  upliftBasis,
  valuesAcrossSkus,
  voucherEdited,
  voucherOption,
  voucherReferences,
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
  if (anchor.source === 'default') return ' (fallback anchor)';
  const mechanic = anchor.mechanic_label ? `, ${anchor.mechanic_label}` : '';
  return anchor.source === 'manual' ? ' (overwritten on Promotion uplift settings)' : ` (usual mechanic${mechanic})`;
}

// The 'i' card under the slider: how the value now was worked out. One
// value explains itself (promoUpliftCalc.explanationLines); several (SKUs
// or anchor versions differ) say so and name each anchor change.
function basisLines(values) {
  const distinct = new Set(values.map((item) => `${item.upliftPct}|${item.level}|${item.effectiveFrom}`));
  if (distinct.size === 1) return explanationLines(values[0].value, values[0].anchor);
  const lines = [anchorLine(values[0].anchor), `Values differ by SKU or month: ${formatPctRange(values.map((item) => item.upliftPct))}.`];
  const changes = [...new Map(values.slice(1).map((item) => [item.effectiveFrom, item])).values()]
    .filter((item) => item.effectiveFrom !== values[0].effectiveFrom);
  for (const item of changes) {
    lines.push(`From ${monthText(item.effectiveFrom)} the anchor is ${item.anchor.mechanic_label}.`);
  }
  lines.push('Promotion uplift settings shows each SKU.');
  return lines;
}

function UpliftBasis({ basis, onReset, workedOut, loading }) {
  if (loading && basis.kind === 'saved') {
    return <p className="text-[11px] text-deep-violet-blue/50">Loading worked-out uplifts…</p>;
  }
  if (basis.kind === 'override') {
    return (
      <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-deep-violet-blue/70">
        <StatusPill tone="info">Edited for this scenario</StatusPill>
        Worked out: {formatPct(workedOut)} ·
        <button
          type="button"
          onClick={onReset}
          className="font-medium text-scenario underline-offset-2 hover:underline"
        >
          Reset
        </button>
      </p>
    );
  }
  if (basis.kind === 'live') {
    return (
      <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-deep-violet-blue/50">
        <span className="inline-flex items-center gap-1">
          <StatusPill tone={levelTone(basis.level)}>{levelLabel(basis.level)}</StatusPill>
          <InfoTooltip label={`How ${levelLabel(basis.level)} was worked out`} variant="card" className="w-72">
            {basisLines(basis.values).map((line) => (
              <span key={line} className="block">{line}</span>
            ))}
          </InfoTooltip>
        </span>
        Move the slider to edit it for this scenario only.
      </p>
    );
  }
  return (
    <p className="text-[11px] text-deep-violet-blue/50">
      The value saved with this promotion{basis.level ? ` (${sourceLabel(basis.level)})` : ''}: nothing is worked out
      for it now. Move the slider to edit it for this scenario only.
    </p>
  );
}

/**
 * Edit form for the selected draft promotion (Promotions Uplift design,
 * Section 6.1 step 6): mechanic from the uplift lookup, voucher Yes/No, an
 * optional override of the mechanic's uplift, the months and an explanation.
 *
 * The mechanic's uplift is the one worked out now (`liveIndex`,
 * scenarioLiveUplifts), with its level and an 'i' card; the mechanic list,
 * anchor and voucher come from `resolved` (the promotion customer's
 * GET /api/settings/promo-uplifts/resolved answer). Choosing a mechanic only
 * sends its key, and the section copies the values in (withReferences). The
 * voucher's value can be edited for this scenario, and Reset goes back to the
 * setting's.
 *
 * @param {{
 *   promotion: object,
 *   onUpdate: (changes: object) => void,
 *   resolved: object | undefined,
 *   liveIndex?: Map<string, object[]> | null,
 *   liveLoading?: boolean,
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
  liveIndex = null,
  liveLoading = false,
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
  const basis = upliftBasis(promotion, liveIndex);
  // What the slider sits on unless edited: the value worked out now for the
  // first month, else the one saved with the promotion.
  const workedOut = (liveIndex ? liveReferences(liveIndex, promotion)?.referenceUpliftPct : null) ?? promotion.referenceUpliftPct;
  const sliderValue = promotion.overrideUpliftPct ?? workedOut;
  const range = MAX_OVERRIDE_PCT - MIN_OVERRIDE_PCT;
  const markerLeft = `${((workedOut - MIN_OVERRIDE_PCT) / range) * 100}%`;
  const voucherSetting = voucherReferences(promotion, resolved);
  const voucherChanged = voucherEdited(promotion, resolved);
  // What is being typed in the voucher box, kept until it is left, so the
  // box can be emptied and retyped; null = show the promotion's value.
  const [voucherText, setVoucherText] = useState(null);

  function commitVoucher() {
    const value = Number(voucherText);
    setVoucherText(null);
    if (voucherText == null || voucherText.trim() === '' || !Number.isFinite(value)) return;
    const pct = Math.min(MAX_OVERRIDE_PCT, Math.max(0, Math.round(value)));
    // Typing the setting's own value back is the setting again, per-SKU values included.
    if (voucherSetting && pct === voucherSetting.voucherUpliftPct) onUpdate(voucherSetting);
    else onUpdate({ voucherUpliftPct: pct, voucherBySku: {} });
  }

  // What each mechanic is worth now for this promotion: its worked-out
  // values and their weakest level, else the resolved settings.
  function liveOption(row) {
    if (!liveIndex) return null;
    const values = liveUpliftValues(liveIndex, { ...promotion, mechanicKey: row.mechanic_key });
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

  function optionText(row) {
    const parts = optionParts(row);
    return `${parts.label} · ${parts.uplift} (${parts.basis})`;
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

      <div>
        <label className={labelClass} htmlFor="promo-customer">Customer</label>
        <select
          id="promo-customer"
          value={promotion.customer}
          onChange={(event) => onUpdate({ customer: event.target.value })}
          className={fieldClass}
        >
          {customerOptions.map((name) => (
            <option key={name} value={name}>{customerLabel(name)}</option>
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
          <MechanicLookupPopover
            rows={mechanics.map(optionParts)}
            anchorPct={anchor?.anchor_pct ?? null}
          />
        </div>
        <select
          id="promo-mechanic"
          value={promotion.mechanicKey}
          onChange={(event) => onUpdate({ mechanicKey: event.target.value, overrideUpliftPct: null })}
          className={fieldClass}
        >
          {mechanics.map((row) => (
            <option key={row.mechanic_key} value={row.mechanic_key}>
              {optionText(row)}
            </option>
          ))}
        </select>
        {anchor ? (
          <p className="mt-0.5 text-[11px] text-deep-violet-blue/50">
            Ordinary month for {customerLabel(promotion.customer)}: {anchor.anchor_pct}% off
            {anchorNote(anchor, ownAnchorPct != null, anchorVaries)}
          </p>
        ) : null}
      </div>

      <div>
        <span className={labelClass}>
          Voucher
          {voucherRow && !promotion.voucher
            ? ` · ${singleValue ? formatPct(voucherSetting?.voucherUpliftPct ?? 0) : formatPctRange(optionValues(voucherRow))}`
            : ''}
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
        {/* Vouchers are never measured: the value saved with the promotion
            counts, and can be edited for this scenario. */}
        {promotion.voucher ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <label className="text-[11px] text-deep-violet-blue/70" htmlFor="promo-voucher-uplift">
              Voucher uplift
            </label>
            <input
              id="promo-voucher-uplift"
              type="number"
              min={0}
              max={MAX_OVERRIDE_PCT}
              step={1}
              value={voucherText ?? String(promotion.voucherUpliftPct)}
              onChange={(event) => setVoucherText(event.target.value)}
              onBlur={commitVoucher}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitVoucher();
              }}
              className={cn(fieldClass, 'w-16 text-right tabular-nums')}
            />
            <span className="text-[11px] text-deep-violet-blue/70">%</span>
            {voucherChanged ? (
              <>
                <StatusPill tone="info">Edited for this scenario</StatusPill>
                <button
                  type="button"
                  onClick={() => onUpdate(voucherSetting)}
                  className="text-[11px] font-medium text-scenario underline-offset-2 hover:underline"
                >
                  Reset to {formatPct(voucherSetting.voucherUpliftPct)}
                </button>
              </>
            ) : null}
          </div>
        ) : null}
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
              onUpdate({ overrideUpliftPct: value === workedOut ? null : value });
            }}
            className="w-full accent-scenario"
          />
          <span
            className="pointer-events-none absolute -bottom-1.5 h-2 w-0.5 -translate-x-1/2 bg-deep-violet-blue/50"
            style={{ left: markerLeft }}
            title={`Worked out ${formatPct(workedOut)}`}
            aria-hidden="true"
          />
        </div>
        <UpliftBasis
          basis={basis}
          workedOut={workedOut}
          loading={liveLoading}
          onReset={() => onUpdate({ overrideUpliftPct: null })}
        />
        <p className="text-[11px] text-deep-violet-blue/50">
          The forecast already reflects an ordinary month
          {anchor ? ` for ${customerLabel(promotion.customer)} (usual: ${anchor.anchor_pct}% off)` : ''}, so this is
          the change on top of that, not the promotion&apos;s whole effect. Planning the usual discount adds about 0%.
        </p>
        <p className="text-[11px] text-deep-violet-blue/70">
          Total uplift: <b>{formatPctRange(effectiveUpliftRange(promotion, liveIndex))}</b>
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
            This promotion changes {customerLabel(promotion.customer)} sell-out by{' '}
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
