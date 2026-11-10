'use client';

import { useEffect, useState } from 'react';

import {
  FORECAST_DATE_SESSION_KEY,
  clearForecastDateSession,
  currentYearDateRange,
  readForecastDateSession,
  writeForecastDateSession,
} from '@/app/utils/dateRange';
import useForecastOptions from '@/hooks/useForecastOptions';

/**
 * SKU / customer / date filters for the Forecast page and the Scenario
 * builder: the first customer, and `defaultRange` (the current year unless a
 * page passes another, e.g. nextYearDateRange) unless this browser tab
 * already picked a range (kept in sessionStorage under `sessionKey`, so
 * leaving the page and coming back keeps it; each page has its own key).
 *
 * `ready` turns true once the options have loaded and the defaults are set;
 * pages pass it to useForecastView so they never fetch with blank filters.
 *
 * @param {{ defaultRange?: (bounds: { start: string, end: string }) => { start: string, end: string }, sessionKey?: string }} [options]
 */
export default function useForecastFilters({
  defaultRange = currentYearDateRange,
  sessionKey = FORECAST_DATE_SESSION_KEY,
} = {}) {
  const { data: options, loading: optionsLoading, error } = useForecastOptions();
  const [productName, setProductName] = useState('');
  // The Scenario builder filters by SKU range instead of SKU; the Forecast
  // page never sets it.
  const [skuRange, setSkuRange] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [ready, setReady] = useState(false);

  // One-time defaults once the options arrive (adjusting state during render,
  // the documented one-time-default case). The options are fetched, so this
  // only ever runs in the browser, after hydration.
  if (!ready && options) {
    const initialRange = defaultRange(options.bounds);
    const savedRange = readForecastDateSession(sessionKey);
    setCustomerName(options.customers[0] ?? '');
    setStartDate(savedRange?.start ?? initialRange.start);
    setEndDate(savedRange?.end ?? initialRange.end);
    setReady(true);
  }

  const bounds = options?.bounds ?? { start: '', end: '' };
  // The "default" state is the page's default year, not the full bounds
  // range -- canClear compares against that, or Clear would look active on a
  // freshly loaded page that hasn't been touched yet.
  const defaultDateRange = defaultRange(bounds);
  const isDefaultRange = startDate === defaultDateRange.start && endDate === defaultDateRange.end;

  // Only a range someone picked is remembered. Saving the default would pin
  // this tab to the year it was first opened in.
  useEffect(() => {
    if (!ready || !startDate || !endDate) return;
    if (isDefaultRange) clearForecastDateSession(sessionKey);
    else writeForecastDateSession(startDate, endDate, sessionKey);
  }, [ready, startDate, endDate, isDefaultRange, sessionKey]);

  const canClear = Boolean(
    productName ||
      skuRange ||
      customerName ||
      startDate !== defaultDateRange.start ||
      endDate !== defaultDateRange.end
  );

  function clear() {
    setProductName('');
    setSkuRange('');
    setCustomerName('');
    setStartDate(defaultDateRange.start);
    setEndDate(defaultDateRange.end);
  }

  return {
    productName,
    setProductName,
    skuRange,
    setSkuRange,
    customerName,
    setCustomerName,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    productOptions: options?.products ?? [],
    skuRangeOptions: options?.skuRanges ?? [],
    customerOptions: options?.customers ?? [],
    bounds,
    ready,
    optionsLoading,
    error,
    canClear,
    clear,
  };
}
