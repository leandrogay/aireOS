'use client';

import FilterBar from '@/components/ui/FilterBar';
import MultiSelectDropdown from '@/components/ui/MultiSelectDropdown';
import { MAPPING_ISSUE_OPTIONS, MAPPING_STATUS_OPTIONS } from '@/app/utils/mappingList';

/**
 * Filter bar above the stored-mappings table, one dropdown per filterable
 * column, in the shared FilterBar the promotion overview uses. Each takes any
 * number of values -- Fairprice and NHG, say -- in the tick-box dropdown the
 * promotion form uses.
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
    <FilterBar label="Filter nomenclatures" hasFilters={hasFilters} onReset={onReset}>
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
        allLabel="All issues"
        options={MAPPING_ISSUE_OPTIONS}
        values={filters.issues}
        onChange={(values) => onChange('issues', values)}
      />
    </FilterBar>
  );
}
