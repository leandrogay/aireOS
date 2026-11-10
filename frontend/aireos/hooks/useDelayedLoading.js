import { useEffect, useState } from 'react';

import { PLACEHOLDER_TIMING } from '@/app/config/transitions';

/**
 * Decides when a first-load placeholder (chart skeleton) shows, so a fast
 * load never flashes it: the placeholder only becomes visible after
 * `PLACEHOLDER_TIMING.delay` of loading, and once visible it stays for at
 * least `minDuration`. Timing lives in app/config/transitions.js.
 *
 * `pending`: render the placeholder instead of the content (still loading, or
 * holding a visible placeholder for its minimum time). `placeholderClass`:
 * put it on the placeholder's outer element -- it keeps the placeholder's
 * space while hidden (no layout shift) and fades it in when it shows.
 *
 * @param {{ loading: boolean }} options
 * @returns {{ pending: boolean, visible: boolean, placeholderClass: string }}
 */
export default function useDelayedLoading({ loading }) {
  // When the placeholder became visible (performance.now()), or null.
  const [shownAt, setShownAt] = useState(null);

  useEffect(() => {
    if (loading && shownAt === null) {
      const timer = setTimeout(() => setShownAt(performance.now()), PLACEHOLDER_TIMING.delay * 1000);
      return () => clearTimeout(timer);
    }
    if (!loading && shownAt !== null) {
      const remaining = shownAt + PLACEHOLDER_TIMING.minDuration * 1000 - performance.now();
      const timer = setTimeout(() => setShownAt(null), Math.max(0, remaining));
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [loading, shownAt]);

  const visible = shownAt !== null;
  return {
    pending: loading || visible,
    visible,
    placeholderClass: `transition-opacity duration-150 motion-reduce:transition-none ${visible ? 'opacity-100' : 'opacity-0'}`,
  };
}
