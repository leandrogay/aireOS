'use client';

import { useState } from 'react';
import { Building2, CheckCircle2, Plus, Search } from 'lucide-react';

import { Skeleton } from '@/components/ui/skeleton';
import { inputClass } from '@/components/ui/formStyles';
import { customerLabel } from '@/app/utils/retailerLabel';
import { cn } from '@/lib/utils';

import { choiceCardClass } from './GuidedFrame';

// More customers than this and a search box helps find one.
const SEARCH_FROM = 9;

/**
 * "Whose file is this?": every customer as a large card, the one the file
 * points at picked already and marked as a suggestion, and a last card that
 * creates a new customer (NewCustomerDialog, opened by the page).
 *
 * @param {{
 *   customers: object[],
 *   loading: boolean,
 *   error: string | null,
 *   customer: object | null,
 *   suggested: boolean,
 *   legacyVendor: string | null,
 *   onChoose: (customerId: number) => void,
 *   onNewCustomer: (name: string) => void,
 *   disabled: boolean,
 * }} props
 */
export default function CustomerPick({ customers, loading, error, customer, suggested, legacyVendor, onChoose, onNewCustomer, disabled }) {
  const [query, setQuery] = useState('');

  if (loading) {
    return (
      <div role="status" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <span className="sr-only">Loading customers…</span>
        {[0, 1, 2, 3].map((item) => (
          <Skeleton key={item} className="h-16 rounded-lg bg-lavander" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Customers could not be loaded: {error}
      </p>
    );
  }

  const typed = query.trim().toLowerCase();
  const shown = typed
    ? customers.filter((item) => customerLabel(item.customer_name).toLowerCase().includes(typed))
    : customers;

  return (
    <>
      {legacyVendor && !customer && (
        <p className="text-sm text-deep-violet-blue/80">
          It was saved as “{legacyVendor}” before customers existed. Choose the customer it belongs to.
        </p>
      )}

      {customers.length >= SEARCH_FROM && (
        <label className="relative block">
          <span className="sr-only">Search customers</span>
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-deep-violet-blue/80" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search customers…"
            className={cn(inputClass, 'pl-9')}
          />
        </label>
      )}

      <div role="radiogroup" aria-label="Customer" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((item) => {
          const selected = item.customer_id === customer?.customer_id;
          const retailerCount = item.retailers?.length || 0;
          return (
            <button
              key={item.customer_id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChoose(item.customer_id)}
              className={choiceCardClass(selected)}
            >
              <Building2 aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-deep-violet-blue" />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{customerLabel(item.customer_name)}</span>
                <span className="block text-xs text-deep-violet-blue/80">
                  {retailerCount} {retailerCount === 1 ? 'retailer' : 'retailers'}
                  {selected && suggested && ' · suggested from the file'}
                </span>
              </span>
              {selected && <CheckCircle2 aria-hidden="true" className="size-5 shrink-0 text-deep-violet-blue" />}
            </button>
          );
        })}

        <button
          type="button"
          disabled={disabled}
          onClick={() => onNewCustomer(query.trim())}
          className={cn(choiceCardClass(false), 'border-dashed')}
        >
          <Plus aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-deep-violet-blue" />
          <span>
            <span className="block font-medium">{typed && !shown.length ? `Create “${query.trim()}”` : 'New customer'}</span>
            <span className="block text-xs text-deep-violet-blue/80">With its online and offline retailers</span>
          </span>
        </button>
      </div>
    </>
  );
}
