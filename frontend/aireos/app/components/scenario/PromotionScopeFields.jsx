'use client';

import MultiSelectDropdown from '@/components/ui/MultiSelectDropdown';
import SelectDropdown from '@/components/ui/SelectDropdown';
import MechanicLookupPopover from '@/components/scenario/MechanicLookupPopover';
import SkuRangePicker from '@/components/scenario/SkuRangePicker';
import { PROMO_OVERLAY_TYPES } from '@/app/utils/forecastView';
import { customerLabel } from '@/app/utils/retailerLabel';

const labelClass = 'mb-0.5 block text-[11px] text-deep-violet-blue/70';

/**
 * Standard searchable scope and mechanic fields for a scenario promotion.
 * Customers and ranges keep their pick-many semantics; none means all.
 *
 * @param {{
 *   promotion: object,
 *   onUpdate: (changes: object) => void,
 *   customerOptions: string[],
 *   skuRangeOptions: string[],
 *   mechanics: Array<{ key: string, label: string, uplift: string, basis: string }>,
 *   anchorPct: number | null,
 *   children?: import('react').ReactNode,
 * }} props
 */
export default function PromotionScopeFields({
  promotion, onUpdate, customerOptions, skuRangeOptions, mechanics, anchorPct, children,
}) {
  return (
    <>
      <div>
        <span className={labelClass}>Customers</span>
        <MultiSelectDropdown
          ariaLabel="Customers"
          options={customerOptions.map((name) => ({ value: name, label: customerLabel(name) }))}
          values={promotion.customers ?? []}
          onChange={(customers) => onUpdate({ customers })}
          allLabel="All customers"
          noneMeansAll
          placeholder="All customers"
          look="field"
          searchable
          searchPlaceholder="Search customers…"
        />
      </div>

      <SkuRangePicker
        id="promo-sku-ranges"
        label="SKU ranges"
        values={promotion.skuRanges ?? []}
        options={skuRangeOptions}
        legacySku={promotion.sku}
        legacyNoun="promotion"
        onChange={(skuRanges) => onUpdate({ skuRanges, sku: skuRanges.length ? '' : promotion.sku })}
      />

      <div>
        <label className={labelClass} htmlFor="promo-type">Promotion type</label>
        <SelectDropdown
          id="promo-type"
          ariaLabel="Promotion type"
          value={promotion.promoType}
          options={PROMO_OVERLAY_TYPES}
          onChange={(promoType) => onUpdate({ promoType })}
          look="field"
          size="md"
        />
      </div>

      <div>
        <div className="flex flex-wrap items-center justify-between gap-x-2">
          <label className={labelClass} htmlFor="promo-mechanic">Mechanic</label>
          <MechanicLookupPopover rows={mechanics} anchorPct={anchorPct} />
        </div>
        <SelectDropdown
          id="promo-mechanic"
          ariaLabel="Mechanic"
          value={promotion.mechanicKey}
          onChange={(mechanicKey) => onUpdate({ mechanicKey, overrideUpliftPct: null })}
          options={mechanics.map((row) => ({
            value: row.key,
            label: row.label,
            hint: `${row.uplift} uplift`,
            description: `${row.label} · ${row.basis}`,
          }))}
          look="field"
          size="md"
          searchable
          searchPlaceholder="Search mechanics…"
        />
        {children}
      </div>
    </>
  );
}
