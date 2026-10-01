'use client';

// Customer (retailer family, e.g. "Fairprice") selector — the first field
// in the dashboard's Filter panel, and the master scope: every other filter
// and query on the dashboard is scoped underneath whichever customer is
// picked here. Plain controlled <select> styled like the SKU/Store fields;
// page.js owns the fetch (useCustomerOptions) and auto-selects the first
// customer once options load, since this is a page-wide scope selector
// everything else waits on, not an optional filter like SKU/Store.
export default function CustomerSelector({ value, onChange, options, loading, error }) {
  return (
    <div>
      <label className="block text-xs text-deep-violet-blue/70 mb-1">Customer</label>
      <select
        aria-label="Customer"
        value={value}
        onChange={(e) => {
          const opt = options.find((o) => o.value === e.target.value);
          onChange(e.target.value, opt?.label ?? '');
        }}
        disabled={loading || options.length === 0}
        className="w-full px-2 py-1 text-xs rounded-md border bg-white text-deep-violet-blue border-violet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet disabled:opacity-50"
      >
        {loading ? (
          <option value="">Loading customers…</option>
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
      {error && <p className="text-red-600 text-xs mt-1">{error}</p>}
    </div>
  );
}
