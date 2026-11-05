'use client';

import { useEffect, useRef } from 'react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { MAX_COMPARED_CUSTOMERS } from '@/app/utils/customerTrend';

/**
 * Customer ticks for the sales dashboard. One ticked customer keeps today's
 * time-series chart. Two or more switch that chart to each customer per week
 * or month (CustomerTrendChart), so at most MAX_COMPARED_CUSTOMERS can be
 * ticked: the rest are disabled until one is unticked. "All customers" is
 * offered only while that many or fewer exist. page.js owns the selection and
 * starts with the first ones ticked once the options load.
 *
 * @param {{ selected: string[], onChange: (next: string[]) => void, options: Array<{ value: string, label: string }>, loading: boolean, error: string | null }} props
 */
export default function CustomerSelector({ selected, onChange, options, loading, error }) {
  const allRef = useRef(null);
  const picked = options.filter((option) => selected.includes(option.value));
  const allChecked = options.length > 0 && picked.length === options.length;
  const someChecked = picked.length > 0 && !allChecked;
  const canTickAll = options.length <= MAX_COMPARED_CUSTOMERS;
  const atCap = picked.length >= MAX_COMPARED_CUSTOMERS;

  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = someChecked;
  }, [someChecked]);

  let summary = '';
  if (picked.length === 1) summary = picked[0].label;
  else if (picked.length > 1 && allChecked) summary = 'All customers';
  else if (picked.length > 1 && picked.length <= 3) summary = picked.map((option) => option.label).join(', ');
  else if (picked.length > 3) summary = `${picked.length} customers`;

  function toggleAll(checked) {
    onChange(checked ? options.map((option) => option.value) : []);
  }

  function toggleOne(value, checked) {
    if (checked && atCap) return;
    onChange(checked ? [...selected, value] : selected.filter((item) => item !== value));
  }

  return (
    <div>
      <label className="block text-xs text-deep-violet-blue/70 mb-1">Customer</label>
      <Popover>
        <PopoverTrigger
          disabled={loading || options.length === 0}
          aria-label="Customer"
          className="flex w-full items-center justify-between rounded-md border border-violet bg-white px-2 py-1 text-left text-xs text-deep-violet-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet disabled:opacity-50"
        >
          <span className={`min-w-0 flex-1 truncate ${summary ? '' : 'text-deep-violet-blue/50'}`}>
            {loading ? 'Loading customers…' : summary || 'No customers'}
          </span>
          <span className="ml-2 shrink-0 text-[10px] text-deep-violet-blue/50" aria-hidden="true">
            ▼
          </span>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-(--anchor-width) gap-0 overflow-hidden rounded-md border border-lavander bg-white p-0 text-deep-violet-blue ring-0"
        >
          <div className="max-h-52 overflow-auto p-2">
            {canTickAll && (
              <label className="flex items-center gap-2 px-1 py-1 text-xs text-deep-violet-blue">
                <input
                  ref={allRef}
                  type="checkbox"
                  checked={allChecked}
                  onChange={(event) => toggleAll(event.target.checked)}
                />
                All customers
              </label>
            )}
            {options.map((option) => {
              const checked = selected.includes(option.value);
              const blocked = !checked && atCap;
              return (
                <label
                  key={option.value}
                  className={`flex items-center gap-2 px-1 py-1 text-xs text-deep-violet-blue ${blocked ? 'opacity-50' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={blocked}
                    onChange={(event) => toggleOne(option.value, event.target.checked)}
                  />
                  {option.label}
                </label>
              );
            })}
          </div>
          {!canTickAll && (
            <p className="border-t border-lavander px-3 py-1.5 text-[11px] text-deep-violet-blue/60">
              Up to {MAX_COMPARED_CUSTOMERS} customers at a time
            </p>
          )}
        </PopoverContent>
      </Popover>
      {error && <p className="text-red-600 text-xs mt-1">{error}</p>}
    </div>
  );
}
