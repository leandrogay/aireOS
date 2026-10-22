'use client';

import { useEffect, useState } from 'react';

import { getForecastView } from '@/app/services/forecastApi';

/**
 * Forecast rows beyond the page's filters, for splitting units-mode building
 * blocks the filters only partly show: an All SKUs block while one SKU is
 * selected, or a block running past the period. A fixed number of units is
 * split by each month's and SKU's share of the block's whole scope, so the
 * engine needs that whole scope (scenarioEngine.splitRowsFor).
 *
 * `needs` comes from scenarioEngine.splitBasisNeeds: one entry per customer,
 * spanning that customer's blocks, fetched with every SKU from the same
 * GET /api/forecast the page uses. Nothing is fetched while no block needs
 * it, so the common case costs no extra request. Entries from before a
 * change stay until the new ones arrive; the engine ignores any that no
 * longer cover a block's months.
 *
 * @param {object} options
 * @param {boolean} options.ready page has its filter options loaded
 * @param {Record<string, { startMonth: string, endMonth: string }>} options.needs
 * @returns {{ basis: Map<string, { startMonth: string, endMonth: string, rows: object[] }>, loading: boolean, error: string | null }}
 */
export default function useUnitsSplitBasis({ ready = false, needs = {} }) {
  const [basis, setBasis] = useState(() => new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // One key for the whole object, so the effect re-runs when any customer's
  // range changes (useDashboardSummary's filterKey pattern).
  const needsKey = JSON.stringify(needs);

  useEffect(() => {
    const wanted = Object.entries(JSON.parse(needsKey));
    if (!ready || !wanted.length) return undefined;
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const results = await Promise.all(
          wanted.map(async ([customer, { startMonth, endMonth }]) => {
            const payload = await getForecastView({ customerName: customer, startDate: startMonth, endDate: endMonth });
            return [customer, { startMonth, endMonth, rows: payload.rows }];
          })
        );
        if (cancelled) return;
        setBasis((current) => new Map([...current, ...results]));
        setError(null);
      } catch (err) {
        if (!cancelled) setError(`Couldn't load the forecast needed to split units blocks: ${err.message}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [ready, needsKey]);

  return { basis, loading, error };
}
