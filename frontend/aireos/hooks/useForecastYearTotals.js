'use client';

import { useEffect, useState } from 'react';

import { getForecastView } from '@/app/services/forecastApi';
import { buildMonthlyPoints, buildYearlyTotals, fullYearWindow } from '@/app/utils/forecastView';

/**
 * Whole-calendar-year volume and revenue totals for the cards under the
 * forecast chart.
 *
 * The cards always read as full years, so when the date filter is narrower
 * than the years it spans (e.g. Jun 2025 - Mar 2026) this fetches the wider
 * Jan-Dec window from the same GET /api/forecast the page uses. When the
 * filter already covers those full years -- the default current-year view --
 * it sums the rows the page already has, so the common case costs no extra
 * request.
 *
 * @param {object} options
 * @param {boolean} options.ready page has its filter options loaded
 * @param {string} options.productName SKU filter, passed straight through
 * @param {string} options.customerName customer filter, passed straight through
 * @param {string} options.startDate filter start, 'YYYY-MM-DD'
 * @param {string} options.endDate filter end, 'YYYY-MM-DD'
 * @param {{ start?: string, end?: string }} options.bounds months that exist
 * @param {object[]} options.rows forecast rows already fetched for the filter
 * @param {object[]} options.actuals monthly actuals already fetched for the filter
 */
export default function useForecastYearTotals({
  ready = false,
  productName = '',
  customerName = '',
  startDate = '',
  endDate = '',
  bounds = {},
  rows = [],
  actuals = [],
}) {
  const [wide, setWide] = useState({ key: '', rows: [], actuals: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const yearWindow = fullYearWindow(startDate, endDate, bounds);
  const needsWiderRange = Boolean(yearWindow) && (yearWindow.start !== startDate || yearWindow.end !== endDate);
  const windowKey = JSON.stringify({
    productName,
    customerName,
    start: yearWindow?.start ?? '',
    end: yearWindow?.end ?? '',
  });

  useEffect(() => {
    if (!ready || !needsWiderRange) return undefined;

    let cancelled = false;

    async function loadFullYears() {
      setLoading(true);
      try {
        const payload = await getForecastView({
          productName,
          customerName,
          startDate: yearWindow.start,
          endDate: yearWindow.end,
        });
        if (cancelled) return;
        // Stamped with the window it answers so a stale payload from the
        // previous filter is never summed into the new one's cards.
        setWide({ key: windowKey, rows: payload.rows, actuals: payload.actuals });
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadFullYears();
    return () => {
      cancelled = true;
    };
  }, [ready, needsWiderRange, windowKey, productName, customerName, yearWindow?.start, yearWindow?.end]);

  const widened = needsWiderRange && wide.key === windowKey;
  const sourceRows = needsWiderRange ? (widened ? wide.rows : []) : rows;
  const sourceActuals = needsWiderRange ? (widened ? wide.actuals : []) : actuals;
  // Both metrics come from the same months, so the cards can show volume and
  // revenue side by side without the chart's Volume/Revenue tab changing them.
  const years = buildYearlyTotals(
    buildMonthlyPoints(sourceRows, sourceActuals, 'units'),
    buildMonthlyPoints(sourceRows, sourceActuals, 'revenue')
  );

  return {
    years,
    loading: needsWiderRange && (loading || !widened),
    error,
  };
}
