'use client';

import { Button } from '@/components/ui/button';

/**
 * The card above a list table that holds its filters (Promotions, SKUs,
 * Nomenclatures): the filters in a wrapping grid, Reset at the bottom right.
 * Filters apply as you pick them (the rows are already loaded, so there is
 * nothing to wait for), which is why there is a Reset but no Apply.
 *
 * Reset sits outside the filters' grid: the filters wrap among themselves, so
 * Reset never gets a whole column (or a row of its own) with empty space after
 * it. Fill it with FilterSelect / MultiSelectDropdown, which share their look
 * (filterControl.js).
 *
 * @param {{
 *   label: string,
 *   hasFilters: boolean,
 *   onReset: () => void,
 *   children: import('react').ReactNode,
 * }} props
 */
export default function FilterBar({ label, hasFilters, onReset, children }) {
  return (
    <section aria-label={label} className="min-w-0 rounded-lg border border-lavander bg-white p-3 shadow-sm">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end">
        <div className="grid min-w-0 flex-1 grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-3">
          {children}
        </div>
        <Button variant="outline" size="lg" onClick={onReset} disabled={!hasFilters} className="self-end">
          Reset
        </Button>
      </div>
    </section>
  );
}
