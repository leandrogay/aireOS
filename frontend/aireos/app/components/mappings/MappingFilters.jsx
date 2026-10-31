'use client';

import { Button } from '@/components/ui/button';
import MultiSelectDropdown from '@/components/ui/MultiSelectDropdown';
import { MAPPING_ISSUE_OPTIONS, MAPPING_STATUS_OPTIONS } from '@/app/utils/mappingList';

/**
 * Filter bar above the stored-mappings table, one dropdown per filterable
 * column. Each takes any number of values -- Fairprice and NHG, say -- in the
 * tick-box dropdown the promotion form uses. Filters apply as they are
 * ticked, so there is a Reset but no Apply.
 *
 * @param {{
 *   filters: { customer: string[], status: string[], issues: string[] },
 *   customers: string[],
 *   hasFilters: boolean,
 *   onChange: (key: string, values: string[]) => void,
 *   onReset: () => void,
 * }} props
 */
export default function MappingFilters({ filters, customers, hasFilters, onChange, onReset }) {
  return (
    <section
      aria-label="Filter nomenclatures"
      className="rounded-lg border border-lavander bg-white p-3 shadow-sm"
    >
      <div className="flex items-end gap-3">
        <div className="grid min-w-0 flex-1 grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-3">
          <MultiSelectDropdown
            label="Customer"
            allLabel="All customers"
            placeholder="No customers yet"
            options={customers.map((customer) => ({ value: customer, label: customer }))}
            values={filters.customer}
            onChange={(values) => onChange('customer', values)}
            searchable={customers.length > 8}
            searchPlaceholder="Search customers…"
          />
          <MultiSelectDropdown
            label="Status"
            allLabel="All statuses"
            options={MAPPING_STATUS_OPTIONS}
            values={filters.status}
            onChange={(values) => onChange('status', values)}
          />
          <MultiSelectDropdown
            label="Issues"
            allLabel="All nomenclatures"
            options={MAPPING_ISSUE_OPTIONS}
            values={filters.issues}
            onChange={(values) => onChange('issues', values)}
          />
        </div>
        <Button variant="outline" size="lg" onClick={onReset} disabled={!hasFilters}>
          Reset
        </Button>
      </div>
    </section>
  );
}
