'use client';

import { useEffect, useState } from 'react';

const EMPTY_RANGE = { start: '', end: '', periodType: null, earliestStart: '', latestWeekStart: '' };

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
 * Bounds are kept with the customers / channel they were read for and only
 * returned while those still apply, so a new selection reads as blank
 * (loading) rather than the previous customers' months, and a failed read
 * leaves them blank. A dataVersion refetch keeps the current bounds.
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
        const params = new URLSearchParams({ period });
        if (customersKey) params.set('customers', customersKey);
        else params.set('customer', customer);
        if (mode) params.set('mode', mode);
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/api/sales/default-date-range?${params.toString()}`,
          { credentials: 'include' },
        );
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setRange({ key, ...EMPTY_RANGE });
          return;
        }
        setRange({
          key,
          start: data.start ?? '',
          end: data.end ?? '',
          periodType: data.period_type ?? null,
          earliestStart: data.earliest_start ?? '',
          latestWeekStart: data.latest_week_start ?? '',
        });
      } catch {
        // Silent: a failed read gives '' bounds for these customers, the
        // same as no filter/default at all (all-time), rather than keeping
        // the previous customers' months or blocking the page.
        if (!cancelled) setRange({ key, ...EMPTY_RANGE });
      }
    }

    fetchRange();
    return () => {
      cancelled = true;
    };
  }, [key, customer, customersKey, mode, dataVersion, period]);

  return range.key === key ? range : EMPTY_RANGE;
}
