'use client';

import { useId } from 'react';

import Dropdown from '@/components/ui/Dropdown';
import { Button } from '@/components/ui/button';
import { inputClass } from '@/components/ui/formStyles';
import { cn } from '@/lib/utils';
import { isPriceRangeInverted, priceRangeSummary } from '@/app/utils/priceRange';

/**
 * A min/max price filter for a FilterBar, on the shared ui/Dropdown shell so
 * it reads like the dropdowns beside it: the closed button says what it is
 * doing ("Any price", "$10.00 – $20.00", "From $10.00"), and the panel holds
 * the two bounds. Values are the inputs' strings, '' = no bound; the list
 * updates as you type, like the other filters.
 *
 * @param {{
 *   label: string,
 *   min: string,
 *   max: string,
 *   onChange: (bounds: { min: string, max: string }) => void,
 *   look?: 'filter' | 'compact',
 * }} props
 */
export default function PriceRangeFilter({ label, min, max, onChange, look = 'filter' }) {
  const labelId = useId();
  const minId = useId();
  const maxId = useId();
  const active = min !== '' || max !== '';
  const inverted = isPriceRangeInverted(min, max);

  return (
    <div className="grid min-w-0 gap-1">
      <span id={labelId} className="text-xs font-medium text-deep-violet-blue/70">
        {label}
      </span>
      <Dropdown
        look={look}
        summary={priceRangeSummary(min, max)}
        active={active}
        ariaLabelledby={labelId}
        footer={(_query, close) => (
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              disabled={!active}
              onClick={() => {
                onChange({ min: '', max: '' });
                close();
              }}
            >
              Clear
            </Button>
          </div>
        )}
      >
        <div className="grid w-56 gap-2 p-1">
          {[
            { id: minId, text: 'Min', value: min, key: 'min' },
            { id: maxId, text: 'Max', value: max, key: 'max' },
          ].map((bound) => (
            <div key={bound.key} className="grid grid-cols-[2.5rem_1fr] items-center gap-2">
              <label htmlFor={bound.id} className="text-xs font-medium text-deep-violet-blue/70">
                {bound.text}
              </label>
              <span className="relative">
                <span aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-deep-violet-blue/50">
                  $
                </span>
                <input
                  id={bound.id}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={bound.value}
                  onChange={(event) => onChange({ min, max, [bound.key]: event.target.value })}
                  className={cn(inputClass, 'pl-6')}
                />
              </span>
            </div>
          ))}
          {inverted && (
            <p role="alert" className="text-[11px] text-red-600">
              Min is above max, so no SKUs match.
            </p>
          )}
        </div>
      </Dropdown>
    </div>
  );
}
