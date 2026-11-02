'use client';

import { Button } from '@/components/ui/button';
import MultiSelectDropdown from '@/components/ui/MultiSelectDropdown';
import { MAPPING_ISSUE_OPTIONS, MAPPING_STATUS_OPTIONS } from '@/app/utils/mappingList';

/**
 * Filters for the stored-mappings table, one compact dropdown per filterable
 * column, laid out inline so they sit in the table card's toolbar. Each takes
 * any number of values -- Fairprice and NHG, say -- in the tick-box dropdown
 * the promotion form uses. Filters apply as they are ticked, so there is a
 * Reset (shown only while something narrows the list) but no Apply.
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
    <div role="group" aria-label="Filter nomenclatures" className="flex flex-wrap items-center gap-2">
      <MultiSelectDropdown
        compact
        label="Customer"
        allLabel="All customers"
        placeholder="No customers yet"
        options={customers.map((customer) => ({ value: customer, label: customer }))}
        values={filters.customer}
        onChange={(values) => onChange('customer', values)}
        searchable={customers.length > 8}
        searchPlaceholder="Search customers…"
        className="w-36"
      />
      <MultiSelectDropdown
        compact
        label="Status"
        allLabel="All statuses"
        options={MAPPING_STATUS_OPTIONS}
        values={filters.status}
        onChange={(values) => onChange('status', values)}
        className="w-36"
      />
      <MultiSelectDropdown
        compact
        label="Issues"
        allLabel="All issues"
        options={MAPPING_ISSUE_OPTIONS}
        values={filters.issues}
        onChange={(values) => onChange('issues', values)}
        className="w-36"
      />
      {hasFilters && (
        <Button variant="ghost" onClick={onReset}>
          Reset
        </Button>
      )}
    </div>
  );
}
