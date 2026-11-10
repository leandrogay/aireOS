'use client';

import { useEffect, useRef, useState } from 'react';

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
  const [summaryByMode, setSummaryByMode] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const filterKey = JSON.stringify({ sku, customer, store, startDate, endDate, granularity });
  const filterKeyRef = useRef(filterKey);
  // The filters + dataVersion of the last fetch that succeeded. The page
  // pauses this hook (`enabled` false) while its By week check reloads, which
  // happens on every customer tick; resuming with the same filters and data
  // must not fetch the same summary again.
  const fetchedRef = useRef('');

  useEffect(() => {
    if (!enabled || !customer || !startDate || !endDate) return undefined;
    if (fetchedRef.current === `${filterKey}|${dataVersion}`) return undefined;

    let cancelled = false;

    const silentRefresh = dataVersion !== 0 && filterKeyRef.current === filterKey;
    filterKeyRef.current = filterKey;

    async function fetchSummary() {
      try {
        if (silentRefresh) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }

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
        if (cancelled) return;

        setSummaryByMode(data);
        setError(null);
        fetchedRef.current = `${filterKey}|${dataVersion}`;
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }

    fetchSummary();
    return () => {
      cancelled = true;
    };
  }, [dataVersion, filterKey, sku, customer, store, startDate, endDate, granularity, enabled]);

  return { summaryByMode, loading, refreshing, error };
}
