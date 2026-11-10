'use client';

import { useEffect, useState } from 'react';

/**
 * Fetches dashboard-summary, shared by RevenueTrendCard and
 * RevenueSummaryCards so they don't each fetch the same data independently.
 * Mirrors the filter-composite-key silent-refresh pattern established for
 * this dashboard: a background dataVersion poll with no filter change
 * refreshes quietly; a real filter change shows the normal loading state.
 *
 * `granularity` (default 'week') lets a long date range (e.g. Past 6
 * Months/Past Year) request monthly-bucketed bars instead — see page.js's
 * chartGranularity, which also applies the same choice to the "previous"
 * period fetch used by the comparison overlay, so the two sides never end
 * up on mismatched granularities.
 *
 * `enabled` (default true) lets a caller skip fetching entirely — used by
 * the chart's side-by-side comparison overlay, which only needs a second
 * call (scoped to the comparison's "previous" period) while a comparison is
 * actually active, not an all-time fetch the rest of the time. It also waits
 * for both dates: without them the request would pull the customer's whole
 * history, only to be fetched again once the range arrives (the same rule
 * as useCustomerTotals / useCustomerTrends).
 */
export default function useDashboardSummary({
  dataVersion = 0,
  sku = '',
  customer = '',
  store = '',
  startDate = '',
  endDate = '',
  granularity = 'week',
  enabled = true,
}) {
  // The last fetch that finished, with the filters and dataVersion it was for.
  // loading / refreshing / error are worked out from it during render rather
  // than switched on and off around each request: a request cancelled by a
  // quick filter change (A, then B, then back to A) can then never leave the
  // hook stuck on loading, and B's error never shows on A.
  const [result, setResult] = useState({ key: null, version: null, summaryByMode: {}, error: null });
  const filterKey = JSON.stringify({ sku, customer, store, startDate, endDate, granularity });
  const ready = enabled && Boolean(customer && startDate && endDate);
  // Already holds these filters at this data version: nothing to fetch. The
  // page pauses this hook (`enabled` false) while its By week check reloads on
  // every customer tick, and resuming must not fetch the same summary again.
  const upToDate = result.key === filterKey && result.version === dataVersion;

  useEffect(() => {
    if (!ready || upToDate) return undefined;

    let cancelled = false;

    async function fetchSummary() {
      try {
        const params = new URLSearchParams({ granularity, customer });
        if (sku) params.set('sku', sku);
        if (store) params.set('store', store);
        if (startDate) params.set('start_date', startDate);
        if (endDate) params.set('end_date', endDate);
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/api/sales/dashboard-summary?${params.toString()}`,
          { credentials: 'include' },
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Failed to load dashboard summary');
        if (!cancelled) setResult({ key: filterKey, version: dataVersion, summaryByMode: data, error: null });
      } catch (err) {
        // A failed background refresh keeps the figures it had for these
        // filters; a failed first load has none to keep.
        if (!cancelled) {
          setResult((previous) => ({
            key: filterKey,
            version: dataVersion,
            summaryByMode: previous.key === filterKey ? previous.summaryByMode : {},
            error: err.message,
          }));
        }
      }
    }

    fetchSummary();
    return () => {
      cancelled = true;
    };
  }, [ready, upToDate, dataVersion, filterKey, sku, customer, store, startDate, endDate, granularity]);

  // Holds these filters' figures: only a newer dataVersion is pending, so the
  // figures stay and the refresh is quiet (refreshing), never loading.
  const current = result.key === filterKey;
  const loading = Boolean(customer) && !current;
  const refreshing = ready && current && result.version !== dataVersion;
  return { summaryByMode: result.summaryByMode, loading, refreshing, error: current ? result.error : null };
}
