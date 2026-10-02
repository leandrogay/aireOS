'use client';

import { Button } from '@/components/ui/button';
import FilterSelect from '@/components/ui/FilterSelect';
import { MAPPING_ISSUE_OPTIONS, MAPPING_STATUS_OPTIONS } from '@/app/utils/mappingList';

/**
 * Filter bar above the stored-mappings table, one dropdown per filterable
 * column. Same behaviour as PromotionFilters: filters apply as you pick them,
 * so there is a Reset but no Apply.
 *
 * @param {{
 *   filters: { vendor: string, status: string, issues: string },
 *   vendors: string[],
 *   hasFilters: boolean,
 *   onChange: (key: string, value: string) => void,
 *   onReset: () => void,
 * }} props
 */
export default function MappingFilters({ filters, vendors, hasFilters, onChange, onReset }) {
  return (
    <section
      aria-label="Filter mappings"
      className="rounded-lg border border-lavander bg-white p-3 shadow-sm"
    >
      <div className="flex items-end gap-3">
        <div className="grid min-w-0 flex-1 grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-3">
          <FilterSelect
            label="Vendor"
            value={filters.vendor}
            allLabel="All vendors"
            options={vendors.map((vendor) => ({ value: vendor, label: vendor }))}
            onChange={(value) => onChange('vendor', value)}
          />
          <FilterSelect
            label="Status"
            value={filters.status}
            allLabel="All statuses"
            options={MAPPING_STATUS_OPTIONS}
            onChange={(value) => onChange('status', value)}
          />
          <FilterSelect
            label="Issues"
            value={filters.issues}
            allLabel="All mappings"
            options={MAPPING_ISSUE_OPTIONS}
            onChange={(value) => onChange('issues', value)}
          />
        </div>
        <Button variant="outline" size="lg" onClick={onReset} disabled={!hasFilters}>
          Reset
        </Button>
      </div>
    </section>
  );
}
