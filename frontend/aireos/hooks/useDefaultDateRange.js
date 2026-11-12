'use client';

import { useEffect, useState } from 'react';

import { getDefaultDateRange } from '@/app/services/salesApi';

const EMPTY_RANGE = { start: '', end: '', periodType: null, earliestStart: '', latestWeekStart: '', error: null };

/**
 * Bounds anchored to the latest available PREFERRED period for the given
 * channel (not the wall-clock date) — see backend get_default_date_range.
 * "Preferred" means: monthly-granularity sell-out rows win over weekly ones
 * for the same retailer+calendar-month, so period='week' can come back with
 * a full month's bounds (period_type: 'month') when that's the latest data
 * actually loaded — not necessarily a 7-day week. The dashboard only asks
 * for the week variant: that latest preferred period is the anchor every
 * date preset (and the MTD default) is built from — see
 * app/utils/dateRangePresets.js. `earliestStart` is the first loaded
 * period's start, so month pickers can block months with no data, and
 * `latestWeekStart` the latest genuine weekly row's start (the weekday
 * the loaded weeks start on), which `start` isn't when the newest data is a
 * monthly total.
 * `periodType` tells callers whether the
 * anchor is a genuine week or a whole month, so they don't assume +6 days.
 * `customers` (the ticked ones) reads across all of them instead of
 * `customer`: the latest period any of them has, the earliest any has.
 *
 * While a new selection (customers / channel) is being read, the last bounds
 * stay, with `updating` true: the page keeps its charts and dates on screen
 * instead of flashing placeholders on every tick, but must not *decide*
 * anything from them (enable months, drop a saved Period) until `updating`
 * is false, since they belong to the previous selection. A failed read
 * blanks them with `error` set, so the page shows its failed card instead of
 * loading for ever. A dataVersion refetch keeps the bounds and isn't
 * `updating` (same selection).
 */
export default function useDefaultDateRange({
  customer = '',
  customers = [],
  mode = 'offline',
  dataVersion = 0,
  period = 'month',
}) {
  const [range, setRange] = useState({ key: '', ...EMPTY_RANGE });

  // One string, so a new array with the same names doesn't refetch.
  const customersKey = customers.join(',');
  const key = JSON.stringify({ customer, customersKey, mode, period });

  useEffect(() => {
    if (!customer && !customersKey) return undefined;

    let cancelled = false;

    async function fetchRange() {
      try {
        const data = await getDefaultDateRange({
          customer,
          customers: customersKey ? customersKey.split(',') : [],
          mode,
          period,
        });
        if (cancelled) return;
        setRange({
          key,
          start: data.start ?? '',
          end: data.end ?? '',
          periodType: data.period_type ?? null,
          earliestStart: data.earliest_start ?? '',
          latestWeekStart: data.latest_week_start ?? '',
          error: null,
        });
      } catch (err) {
        // '' bounds for these customers, never the previous customers'
        // months; `error` lets the page show its failed card with Try again.
        if (!cancelled) setRange({ key, ...EMPTY_RANGE, error: err.message || 'Failed to load the latest loaded period' });
      }
    }

    fetchRange();
    return () => {
      cancelled = true;
    };
  }, [key, customer, customersKey, mode, dataVersion, period]);

  // Pending for a new selection: the last bounds stay (see above), and an
  // earlier error only counts for the selection it was read for.
  const updating = Boolean(customer || customersKey) && range.key !== key;
  const { key: _readFor, ...bounds } = range;
  return { ...bounds, error: updating ? null : bounds.error, updating };
}
