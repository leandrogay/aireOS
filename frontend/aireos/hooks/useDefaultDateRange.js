'use client';

import { useEffect, useState } from 'react';

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
 */
export default function useDefaultDateRange({
  customer = '',
  mode = 'offline',
  dataVersion = 0,
  period = 'month',
}) {
  const [range, setRange] = useState({ start: '', end: '', periodType: null, earliestStart: '', latestWeekStart: '' });

  useEffect(() => {
    if (!customer) return undefined;

    let cancelled = false;

    async function fetchRange() {
      try {
        const params = new URLSearchParams({ period, customer });
        if (mode) params.set('mode', mode);
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/api/sales/default-date-range?${params.toString()}`
        );
        const data = await res.json();
        if (!res.ok || cancelled) return;
        setRange({
          start: data.start ?? '',
          end: data.end ?? '',
          periodType: data.period_type ?? null,
          earliestStart: data.earliest_start ?? '',
          latestWeekStart: data.latest_week_start ?? '',
        });
      } catch {
        // Silent — if this fails, callers just get '' bounds, same as no
        // filter/default at all (all-time), rather than blocking the page.
      }
    }

    fetchRange();
    return () => {
      cancelled = true;
    };
  }, [customer, mode, dataVersion, period]);

  return range;
}
