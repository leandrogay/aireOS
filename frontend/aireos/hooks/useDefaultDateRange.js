'use client';

import { useEffect, useState } from 'react';

/**
 * Week or month bounds anchored to the latest available week for the given
 * channel (not the wall-clock date) — see backend get_default_date_range.
 * The dashboard only asks for the week variant: that latest loaded week is
 * the anchor every date preset (and the MTD default) is built from — see
 * app/utils/dateRangePresets.js.
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
