'use client';

import MultiSelectDropdown from '@/components/ui/MultiSelectDropdown';
import { MAX_COMPARED_CUSTOMERS } from '@/app/utils/customerTrend';

/**
 * Customer ticks for the sales dashboard. One ticked customer keeps today's
 * time-series chart. Two or more switch that chart to each customer per week
 * or month (CustomerTrendChart), so at most MAX_COMPARED_CUSTOMERS can be
 * ticked: the rest are disabled until one is unticked. "All customers" is
 * offered only while that many or fewer exist (MultiSelectDropdown's
 * `maxSelected`). page.js owns the selection and starts with the first ones
 * ticked once the options load.
 *
 * @param {{ selected: string[], onChange: (next: string[]) => void, options: Array<{ value: string, label: string }>, loading: boolean, error: string | null }} props
 */
export default function CustomerSelector({ selected, onChange, options, loading, error }) {
  return (
    <div>
      <label className="block text-xs text-deep-violet-blue/70 mb-1">Customer</label>
      <MultiSelectDropdown
        ariaLabel="Customer"
        look="compact"
        options={options}
        values={selected}
        onChange={onChange}
        allLabel="All customers"
        noneMeansAll={false}
        maxSelected={MAX_COMPARED_CUSTOMERS}
        placeholder={loading ? 'Loading customers…' : 'No customers'}
        disabled={loading || options.length === 0}
      />
      {error && <p className="text-red-600 text-xs mt-1">{error}</p>}
    </div>
  );
}
