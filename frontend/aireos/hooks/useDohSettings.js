'use client';

import { useEffect, useState } from 'react';

import { getDohSettings } from '@/app/services/settingsApi';

/**
 * Every customer's DOH settings (backend settings/doh.list_settings, read from
 * the current_settings view). `refreshKey` is bumped to refetch.
 *
 * `replaceRow` swaps in the `settings` row a save, reset or alert change
 * returns, so the table shows the server's new state at once without a
 * refetch (and without the old value flashing back while one runs).
 *
 * @param {{ refreshKey?: number }} [options]
 * @returns {{ data: object[], loading: boolean, error: string | null, replaceRow: (settings: object) => void }}
 */
export default function useDohSettings({ refreshKey = 0 } = {}) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchSettings() {
      setLoading(true);
      try {
        const result = await getDohSettings();
        if (cancelled) return;
        setData(result);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchSettings();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  function replaceRow(settings) {
    setData((rows) => rows.map((row) => (row.customer_id === settings.customer_id ? settings : row)));
  }

  return { data, loading, error, replaceRow };
}
