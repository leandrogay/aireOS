'use client';

import { useEffect, useState } from 'react';

import { getForecastView } from '@/app/services/forecastApi';
import { shiftMonth } from '@/app/utils/scenarioPlan';

/**
 * Monthly actuals for the same months one year earlier, for the Scenario
 * builder's monthly plan (Last year actual and the variance against it).
 *
 * Last year's months usually sit before the date filter (viewing Nov 26 -
 * Dec 27 needs Nov 25 - Dec 26), so this fetches them from the same
 * GET /api/forecast the page uses, with the dates moved back 12 months,
 * the way useForecastYearTotals fetches whole years. When the filter already
 * reaches back that far, the page's own actuals are used and nothing is
 * fetched.
 *
 * @param {object} options
 * @param {boolean} options.ready page has its filter options loaded
 * @param {string} options.productName SKU filter
 * @param {string} options.customerName customer filter
 * @param {string} options.startDate filter start, 'YYYY-MM-DD'
 * @param {string} options.endDate filter end, 'YYYY-MM-DD'
 * @param {object[]} options.actuals monthly actuals already fetched for the filter
 * @returns {{ actuals: object[], loading: boolean, error: string | null }}
 */
export default function useLastYearActuals({
  ready = false,
  productName = '',
  customerName = '',
  startDate = '',
  endDate = '',
  actuals = [],
}) {
  const [fetched, setFetched] = useState({ key: '', actuals: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const lastYearStart = startDate ? shiftMonth(`${startDate.slice(0, 7)}-01`, -12) : '';
  const lastYearEnd = endDate ? shiftMonth(`${endDate.slice(0, 7)}-01`, -12) : '';
  // The filter's own actuals already hold last year's months.
  const covered = Boolean(startDate) && startDate <= lastYearStart;
  const key = JSON.stringify({ productName, customerName, lastYearStart, lastYearEnd });

  useEffect(() => {
    if (!ready || covered || !lastYearStart || !lastYearEnd) return undefined;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const payload = await getForecastView({
          productName,
          customerName,
          startDate: lastYearStart,
          endDate: lastYearEnd,
        });
        if (!cancelled) {
          setFetched({ key, actuals: payload.actuals });
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(`Couldn't load last year's actuals: ${err.message}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [ready, covered, key, productName, customerName, lastYearStart, lastYearEnd]);

  if (covered) return { actuals, loading: false, error: null };
  // Never show the previous filter's last year against this one's forecast.
  const current = fetched.key === key;
  return { actuals: current ? fetched.actuals : [], loading: loading || (!current && !error), error };
}
