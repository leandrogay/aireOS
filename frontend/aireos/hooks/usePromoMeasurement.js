'use client';

import { useEffect, useState } from 'react';

import { getPromoMeasurementStatus, getPromoUpliftNotes } from '@/app/services/promoUpliftsApi';

/**
 * The measurement's status (last run, last successful run, stale) and the open notes
 * on typed values, for the Promotion Uplift Settings page (backend
 * promo_measurement.measurement_status / list_notes). `refreshKey` is bumped
 * to refetch, e.g. after Re-measure or a note decision.
 *
 * @param {{ refreshKey?: number }} [options]
 * @returns {{ status: object | null, notes: object[], loading: boolean, error: string | null }}
 */
export default function usePromoMeasurement({ refreshKey = 0 } = {}) {
  const [state, setState] = useState({ status: null, notes: [], loading: true, error: null });

  useEffect(() => {
    let cancelled = false;

    async function fetchMeasurement() {
      try {
        const [status, notes] = await Promise.all([getPromoMeasurementStatus(), getPromoUpliftNotes()]);
        if (!cancelled) setState({ status, notes, loading: false, error: null });
      } catch (err) {
        if (!cancelled) setState((current) => ({ ...current, loading: false, error: err.message }));
      }
    }

    fetchMeasurement();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return state;
}
