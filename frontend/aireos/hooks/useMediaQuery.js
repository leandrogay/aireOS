'use client';

import { useSyncExternalStore } from 'react';

/**
 * Whether a CSS media query currently matches, kept in step as the window
 * changes. On the server (no window) it reports false.
 * @param {string} query e.g. '(max-width: 767px)'
 */
export default function useMediaQuery(query) {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(query);
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
