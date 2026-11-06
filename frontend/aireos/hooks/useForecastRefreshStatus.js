'use client';

import { useEffect, useState } from 'react';

import { getForecastRefreshStatus } from '@/app/services/forecastApi';
import { notificationsStreamUrl } from '@/app/services/notificationsApi';
import { nextStatusCheckDelay } from '@/app/utils/forecastLineText';

const NOT_UPDATING = { updating: false, since: null };

/**
 * Whether an event forecast refresh is waiting or running, for the
 * "Forecast updating…" badge (GET /api/forecast/refresh-status).
 *
 * Checked when the page opens and whenever the notification stream reports a
 * change (a finished refresh writes a success/failure notification). A
 * refresh that retrains nothing writes no notification, so while the badge
 * shows it is also re-checked every minute (nextStatusCheckDelay) and the
 * timer stops once the status clears. No timer runs otherwise.
 *
 * Opens its own EventSource: the bell's stream lives inside useNotifications
 * and isn't shared. A failed check reads as "not updating", which only hides
 * the badge.
 *
 * @returns {{ data: { updating: boolean, since: string | null }, loading: boolean, error: string | null }}
 */
export default function useForecastRefreshStatus() {
  const [data, setData] = useState(NOT_UPDATING);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let timer = null;

    async function check() {
      let next = NOT_UPDATING;
      let message = null;
      try {
        next = await getForecastRefreshStatus();
      } catch (err) {
        message = err.message;
      }
      if (cancelled) return;
      setData(next);
      setError(message);
      setLoading(false);
      // Cleared before every new timer, so a stream event that lands while a
      // timed check is in flight can't leave two timers running.
      clearTimeout(timer);
      timer = null;
      const delay = nextStatusCheckDelay(next);
      if (delay != null) timer = setTimeout(check, delay);
    }

    check();
    // withCredentials sends the session cookie cross-origin (see useNotifications).
    const source = new EventSource(notificationsStreamUrl(), { withCredentials: true });
    source.addEventListener('changed', check);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      source.close();
    };
  }, []);

  return { data, loading, error };
}
