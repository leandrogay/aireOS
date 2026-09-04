'use client';

import { useEffect, useState } from 'react';

/**
 * Drives the current/previous period comparison. `startDate`/`endDate` here
 * should be the dashboard's *effective* current scope (including its
 * current-month default — see useDefaultDateRange) — this hook reads that
 * as the comparison's "current" side, but does NOT drive it: reporting a
 * resolved date range up via onDateRangeChange (when a preset is picked)
 * still narrows RevenueTrendCard/RevenueSummaryCards/SkuRanking to match,
 * but merely having a current scope does not, by itself, activate a
 * comparison — see `active` below.
 *
 * Inactive until the user picks a WoW/MoM/YoY preset. Picking a Date Range
 * (directly, or via the Filter panel's This Week/This Month quick buttons)
 * changes what WOULD be compared but does not, on its own, turn the
 * comparison on — the user has to press Compare To themselves.
 *
 * `previousStart`/`previousEnd` are read-only from a caller's perspective —
 * once a preset resolves, they hold the backend-computed previous range
 * (used to drive the chart's side-by-side "previous" fetch — see page.js's
 * previousSummary), not something a caller sets to change what's compared.
 * Their setters are only exposed for resetting on clear-all-filters.
 *
 * Must be called in the same component that owns startDate/endDate (i.e.
 * page.js), not a descendant — the "external change" detection below relies
 * on this hook's own setAppliedRange and the caller's setStartDate/setEndDate
 * (via onDateRangeChange) landing in the same render batch, which only
 * happens when both live in the same component.
 */
export default function usePeriodComparison({
  sku = '',
  mode = 'offline',
  customer = '',
  store = '',
  startDate = '',
  endDate = '',
  onDateRangeChange,
  dataVersion = 0,
}) {
  const [comparisonType, setComparisonType] = useState(null);
  const [previousStart, setPreviousStart] = useState('');
  const [previousEnd, setPreviousEnd] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [appliedRange, setAppliedRange] = useState([startDate, endDate]);

  // A comparison is only "active" once the user has picked a WoW/MoM/YoY
  // preset. The current scope existing (even a non-empty one) isn't enough
  // on its own — that just describes what the dashboard is showing right now.
  const active = Boolean(comparisonType);

  // If the shared current scope changed for a reason other than this hook's
  // own last resolution (e.g. This Week/This Month, editing Date Range
  // directly, or clearing its badge), drop out of preset mode and forget
  // the old previous-period pick — it no longer corresponds to the new
  // current range — so a comparison, if re-engaged, starts fresh rather
  // than silently comparing against a stale, mismatched period.
  if (appliedRange[0] !== startDate || appliedRange[1] !== endDate) {
    setAppliedRange([startDate, endDate]);
    if (comparisonType) setComparisonType(null);
    setPreviousStart('');
    setPreviousEnd('');
  }

  useEffect(() => {
    // Consumers gate on `active` before reading result/loading/error, so a
    // stale value left over from a previous active period is never shown —
    // no need to reset it here, which would just be a setState-in-effect
    // for no visible benefit.
    if (!active || !customer) return undefined;

    let cancelled = false;

    async function fetchComparison() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ customer, comparison_type: comparisonType });
        if (mode) params.set('mode', mode);
        if (sku) params.set('sku', sku);
        if (store) params.set('store', store);

        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/api/sales/period-comparison?${params.toString()}`
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Failed to load period comparison');
        if (cancelled) return;

        setResult(data);
        if (data.current.start !== startDate || data.current.end !== endDate) {
          setAppliedRange([data.current.start ?? '', data.current.end ?? '']);
          onDateRangeChange(data.current.start ?? '', data.current.end ?? '');
        }
        if (data.previous.start !== previousStart || data.previous.end !== previousEnd) {
          setPreviousStart(data.previous.start ?? '');
          setPreviousEnd(data.previous.end ?? '');
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchComparison();
    return () => {
      cancelled = true;
    };
  }, [
    active,
    comparisonType,
    sku,
    mode,
    customer,
    store,
    dataVersion,
    startDate,
    endDate,
    previousStart,
    previousEnd,
    onDateRangeChange,
  ]);

  return {
    comparisonType,
    setComparisonType,
    previousStart,
    previousEnd,
    setPreviousStart,
    setPreviousEnd,
    result,
    loading,
    error,
    active,
  };
}
