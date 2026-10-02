'use client';

import { ChevronDown } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { promoTypeLabel } from '@/app/utils/promotionForm';
import { PROMOTION_STATUSES } from '@/app/utils/promotionOverview';
import { retailerLabel } from '@/app/utils/retailerLabel';

// A native select keeps keyboard, screen reader and mobile behaviour for free;
// the chevron is drawn over it because appearance-none removes the built-in one.
function FilterSelect({ label, value, allLabel, options, onChange }) {
  return (
    <label className="grid min-w-0 gap-1 text-xs font-medium text-deep-violet-blue/70">
      {label}
      <span className="relative">
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={`h-9 w-full appearance-none truncate rounded-lg border bg-white pl-2.5 pr-8 text-sm font-normal outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 ${
            value
              ? 'border-deep-violet-blue text-deep-violet-blue'
              : 'border-lavander text-deep-violet-blue/70 hover:bg-cream/60'
          }`}
        >
          <option value="">{allLabel}</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-deep-violet-blue/50"
        />
      </span>
    </label>
  );
}

const asOptions = (values, toLabel = (value) => value) =>
  values.map((value) => ({ value, label: toLabel(value) }));

/**
 * Filter bar above the promotion table. Filters apply as you pick them (the
 * rows are already loaded, so there is nothing to wait for), which is why
 * there is a Reset but no Apply.
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
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-[repeat(6,minmax(0,1fr))_auto]">
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
        <div className="flex items-end">
          <Button variant="outline" size="lg" onClick={onReset} disabled={!hasFilters}>
            Reset
          </Button>
        </div>
      </div>
    </section>
  );
}
