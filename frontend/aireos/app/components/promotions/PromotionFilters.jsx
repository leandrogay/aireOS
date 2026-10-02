'use client';

import { Button } from '@/components/ui/button';
import FilterSelect from '@/components/ui/FilterSelect';
import { promoTypeLabel } from '@/app/utils/promotionForm';
import { PROMOTION_STATUSES } from '@/app/utils/promotionOverview';
import { retailerLabel } from '@/app/utils/retailerLabel';

const asOptions = (values, toLabel = (value) => value) =>
  values.map((value) => ({ value, label: toLabel(value) }));

/**
 * Filter bar above the promotion table. Filters apply as you pick them (the
 * rows are already loaded, so there is nothing to wait for), which is why
 * there is a Reset but no Apply.
 *
 * Reset sits outside the filters' grid, pinned to the bar's bottom-right
 * corner: the filters wrap among themselves, so Reset never gets a whole
 * column (or a row of its own) with empty space after it.
 *
 * @param {{
 *   filters: { retailer: string, storeName: string, period: string, promoType: string, mechanic: string, status: string },
 *   options: { retailers: string[], stores: string[], periods: string[], types: string[], mechanics: string[] },
 *   hasFilters: boolean,
 *   onChange: (key: string, value: string) => void,
 *   onReset: () => void,
 * }} props
 */
export default function PromotionFilters({ filters, options, hasFilters, onChange, onReset }) {
  return (
    <section
      aria-label="Filter promotions"
      className="rounded-lg border border-lavander bg-white p-3 shadow-sm"
    >
      <div className="flex items-end gap-3">
        <div className="grid min-w-0 flex-1 grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-3">
          <FilterSelect
            label="Retailer"
            value={filters.retailer}
            allLabel="All retailers"
            options={asOptions(options.retailers, retailerLabel)}
            onChange={(value) => onChange('retailer', value)}
          />
          <FilterSelect
            label="Store"
            value={filters.storeName}
            allLabel="All stores"
            options={asOptions(options.stores)}
            onChange={(value) => onChange('storeName', value)}
          />
          <FilterSelect
            label="Period"
            value={filters.period}
            allLabel="All periods"
            options={asOptions(options.periods)}
            onChange={(value) => onChange('period', value)}
          />
          <FilterSelect
            label="Promo type"
            value={filters.promoType}
            allLabel="All types"
            options={asOptions(options.types, promoTypeLabel)}
            onChange={(value) => onChange('promoType', value)}
          />
          <FilterSelect
            label="Mechanic"
            value={filters.mechanic}
            allLabel="All mechanics"
            options={asOptions(options.mechanics)}
            onChange={(value) => onChange('mechanic', value)}
          />
          <FilterSelect
            label="Status"
            value={filters.status}
            allLabel="All statuses"
            options={PROMOTION_STATUSES}
            onChange={(value) => onChange('status', value)}
          />
        </div>
        <Button variant="outline" size="lg" onClick={onReset} disabled={!hasFilters}>
          Reset
        </Button>
      </div>
    </section>
  );
}
