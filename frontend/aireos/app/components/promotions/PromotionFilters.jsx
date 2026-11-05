'use client';

import FilterBar from '@/components/ui/FilterBar';
import FilterSelect from '@/components/ui/FilterSelect';
import { promoTypeLabel } from '@/app/utils/promotionForm';
import { PROMOTION_STATUSES } from '@/app/utils/promotionOverview';
import { retailerLabel } from '@/app/utils/retailerLabel';

const asOptions = (values, toLabel = (value) => value) =>
  values.map((value) => ({ value, label: toLabel(value) }));

/**
 * Filter bar above the promotion table, one dropdown per filterable column
 * in the shared FilterBar.
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
    <FilterBar label="Filter promotions" hasFilters={hasFilters} onReset={onReset}>
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
    </FilterBar>
  );
}
