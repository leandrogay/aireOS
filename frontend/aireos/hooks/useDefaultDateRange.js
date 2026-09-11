'use client';

import { useEffect, useState } from 'react';

/**
 * Week or month bounds anchored to the latest available week for the given
 * channel (not the wall-clock date) — see backend get_default_date_range.
 * The month variant is used as the dashboard's default *fetch* scope
 * (chart, revenue summary, SKU ranking) when no explicit Date Range filter
 * is active — that usage never shows as an active filter (no badge, no
 * pre-filled Date Range inputs). Both variants are also used by the Filter
 * panel's "This Week"/"This Month" quick buttons, which DO apply an
 * explicit filter (and highlight themselves) when clicked.
 */
export default function useDefaultDateRange({
  customer = '',
  mode = 'offline',
  dataVersion = 0,
  period = 'month',
}) {
  const [range, setRange] = useState({ start: '', end: '' });

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
        setRange({ start: data.start ?? '', end: data.end ?? '' });
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
