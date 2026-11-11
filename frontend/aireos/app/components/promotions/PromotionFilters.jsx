'use client';

import FilterBar from '@/components/ui/FilterBar';
import MultiSelectDropdown from '@/components/ui/MultiSelectDropdown';
import { promoTypeLabel } from '@/app/utils/promotionForm';
import { PROMOTION_STATUSES } from '@/app/utils/promotionOverview';
import { retailerLabel } from '@/app/utils/retailerLabel';

const asOptions = (values, toLabel = (value) => value) =>
  values.map((value) => ({ value, label: toLabel(value) }));

/**
 * Filter bar above the promotion table, one dropdown per filterable column
 * in the shared FilterBar. Each takes any number of values in the tick-box
 * dropdown MappingFilters uses; the long lists (retailer, store, period,
 * mechanic) can be searched, the short fixed ones (type, status) can't.
 *
 * @param {{
 *   filters: { retailer: string[], storeName: string[], period: string[], promoType: string[], mechanic: string[], status: string[] },
 *   options: { retailers: string[], stores: string[], periods: string[], types: string[], mechanics: string[] },
 *   hasFilters: boolean,
 *   onChange: (key: string, values: string[]) => void,
 *   onReset: () => void,
 * }} props
 */
export default function PromotionFilters({ filters, options, hasFilters, onChange, onReset }) {
  return (
    <FilterBar label="Filter promotions" hasFilters={hasFilters} onReset={onReset}>
      <MultiSelectDropdown
        look="compact"
        label="Retailer"
        allLabel="All retailers"
        options={asOptions(options.retailers, retailerLabel)}
        values={filters.retailer}
        onChange={(values) => onChange('retailer', values)}
        searchable
        searchPlaceholder="Search retailers…"
      />
      <MultiSelectDropdown
        look="compact"
        label="Store"
        allLabel="All stores"
        options={asOptions(options.stores)}
        values={filters.storeName}
        onChange={(values) => onChange('storeName', values)}
        searchable
        searchPlaceholder="Search stores…"
      />
      <MultiSelectDropdown
        look="compact"
        label="Period"
        allLabel="All periods"
        options={asOptions(options.periods)}
        values={filters.period}
        onChange={(values) => onChange('period', values)}
        searchable
        searchPlaceholder="Search periods…"
      />
      <MultiSelectDropdown
        look="compact"
        label="Promo type"
        allLabel="All types"
        options={asOptions(options.types, promoTypeLabel)}
        values={filters.promoType}
        onChange={(values) => onChange('promoType', values)}
      />
      <MultiSelectDropdown
        look="compact"
        label="Mechanic"
        allLabel="All mechanics"
        options={asOptions(options.mechanics)}
        values={filters.mechanic}
        onChange={(values) => onChange('mechanic', values)}
        searchable
        searchPlaceholder="Search mechanics…"
      />
      <MultiSelectDropdown
        look="compact"
        label="Status"
        allLabel="All statuses"
        options={PROMOTION_STATUSES}
        values={filters.status}
        onChange={(values) => onChange('status', values)}
      />
    </FilterBar>
  );
}
