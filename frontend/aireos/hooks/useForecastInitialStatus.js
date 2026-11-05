'use client';

import { useEffect, useState } from 'react';

import { getForecastInitialStatus } from '@/app/services/forecastApi';

/**
 * Lock state of each Initial Yearly Forecast year, for the note under the
 * forecast chart (GET /api/forecast/initial-status). Fetched once per page
 * visit: the table has one row per year and changes at most a few times a
 * year. The backend never errors on this read; a failed request here leaves
 * the list empty, which only hides the note.
 *
 * @returns {{ data: object[], loading: boolean, error: string | null }}
 */
export default function useForecastInitialStatus() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const years = await getForecastInitialStatus();
        if (!cancelled) setData(years);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { data, loading, error };
}
