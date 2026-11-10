'use client';

import MultiSelectDropdown from '@/components/ui/MultiSelectDropdown';

/**
 * Customer ticks for the sales dashboard. One ticked customer keeps today's
 * time-series chart. Two or more switch that chart to each customer per week
 * or month (CustomerTrendChart). Any number can be ticked: the chart turns
 * from bars to lines once there would be too many bars (utils/chartKind.js).
 * page.js owns the selection and starts with every customer ticked once the
 * options load.
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
        // With customers to pick from, an empty box asks for one; "No
        // customers" is only true when there are none.
        placeholder={loading ? 'Loading customers…' : options.length ? 'Select customers' : 'No customers'}
        disabled={loading || options.length === 0}
      />
      {error && <p className="text-red-600 text-xs mt-1">{error}</p>}
    </div>
  );
}
