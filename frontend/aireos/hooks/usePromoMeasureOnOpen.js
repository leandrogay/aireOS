'use client';

import { useEffect, useState } from 'react';

import { measurePromoUpliftsIfChanged } from '@/app/services/promoUpliftsApi';

/**
 * The Promotion Uplift Settings page's safety net when it opens: measures
 * promotion uplifts if sales, promotions or settings changed since the last
 * successful run (backend promo_measurement.measure_after_change('page_load'),
 * which never fails and records nothing when nothing changed). `runs` goes up
 * by one when the check ran a measurement (or recorded a failure), so the page
 * adds it to its refresh key and refetches.
 *
 * @returns {{ checking: boolean, runs: number }}
 */
export default function usePromoMeasureOnOpen() {
  const [state, setState] = useState({ checking: true, runs: 0 });

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const run = await measurePromoUpliftsIfChanged();
        const measured = run.status !== 'skipped_unchanged' && run.status !== 'in_progress';
        if (!cancelled) setState((current) => ({ checking: false, runs: current.runs + (measured ? 1 : 0) }));
      } catch {
        // The status panel already reports a backend it can't reach; the check has nothing to add.
        if (!cancelled) setState((current) => ({ ...current, checking: false }));
      }
    }

    check();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
