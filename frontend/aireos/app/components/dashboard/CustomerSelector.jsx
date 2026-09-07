'use client';

// Page-header customer (retailer family, e.g. "Fairprice") selector — every
// other filter and query on the dashboard is scoped underneath whichever
// customer is picked here. Plain controlled <select>; page.js owns the
// fetch (useCustomerOptions) and auto-selects the first customer once
// options load, since this is a page-wide scope selector everything else
// waits on, not an optional filter like SKU/Store.
export default function CustomerSelector({ value, onChange, options, loading, error }) {
  return (
    <div className="flex items-center gap-2">
      <select
        aria-label="Customer"
        value={value}
        onChange={(e) => {
          const opt = options.find((o) => o.value === e.target.value);
          onChange(e.target.value, opt?.label ?? '');
        }}
        disabled={loading || options.length === 0}
        className="px-2 py-1 text-sm rounded-md border bg-white text-deep-violet-blue border-violet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet disabled:opacity-50"
      >
        {loading ? (
          <option value="">Loading…</option>
        ) : options.length === 0 ? (
          <option value="">No customers</option>
        ) : (
          options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))
        )}
      </select>
      {error && <p className="text-red-600 text-xs">{error}</p>}
    </div>
  );
}
