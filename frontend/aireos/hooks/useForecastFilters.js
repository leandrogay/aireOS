'use client';

import { useEffect, useState } from 'react';

import { currentYearDateRange, readForecastDateSession, writeForecastDateSession } from '@/app/utils/dateRange';
import useForecastOptions from '@/hooks/useForecastOptions';

/**
 * SKU / customer / date filters for the Forecast page and the Scenario
 * builder, with the same defaults on both: the first customer, and the
 * current year unless this browser tab already picked a range (kept in
 * sessionStorage, so leaving the page and coming back keeps it).
 *
 * `ready` turns true once the options have loaded and the defaults are set;
 * pages pass it to useForecastView so they never fetch with blank filters.
 */
export default function useForecastFilters() {
  const { data: options, loading: optionsLoading, error } = useForecastOptions();
  const [productName, setProductName] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [ready, setReady] = useState(false);

  // One-time defaults once the options arrive (adjusting state during render,
  // the documented one-time-default case). The options are fetched, so this
  // only ever runs in the browser, after hydration.
  if (!ready && options) {
    const defaultRange = currentYearDateRange(options.bounds);
    const savedRange = readForecastDateSession();
    setCustomerName(options.customers[0] ?? '');
    setStartDate(savedRange?.start ?? defaultRange.start);
    setEndDate(savedRange?.end ?? defaultRange.end);
    setReady(true);
  }

  useEffect(() => {
    if (!ready || !startDate || !endDate) return;
    writeForecastDateSession(startDate, endDate);
  }, [ready, startDate, endDate]);

  const bounds = options?.bounds ?? { start: '', end: '' };
  // The "default" state is the current year, not the full bounds range --
  // canClear compares against that, or Clear would look active on a freshly
  // loaded page that hasn't been touched yet.
  const defaultDateRange = currentYearDateRange(bounds);
  const canClear = Boolean(
    productName || customerName || startDate !== defaultDateRange.start || endDate !== defaultDateRange.end
  );

  function clear() {
    setProductName('');
    setCustomerName('');
    setStartDate(defaultDateRange.start);
    setEndDate(defaultDateRange.end);
  }

  return {
    productName,
    setProductName,
    customerName,
    setCustomerName,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    productOptions: options?.products ?? [],
    customerOptions: options?.customers ?? [],
    bounds,
    ready,
    optionsLoading,
    error,
    canClear,
    clear,
  };
}
