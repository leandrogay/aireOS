'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';

import { PAGE_CASCADE } from '@/app/config/transitions';
import { cascadeCards } from '@/lib/cardCascade';

// Whether a page has been shown in this browser tab yet. Every page mounts its
// own PageLayout, so a module-level flag (like Sidebar's lastCollapsed) tells a
// client-side navigation from the first load: the first page is
// server-rendered and appears as-is, every page after it springs in. On the
// server it stays false (effects never run there), so the server HTML and the
// first client render agree.
let pageShown = false;

/**
 * The page content column. On a client-side navigation its heading and cards
 * spring in one by one (lib/cardCascade.js). Used by PageLayout around its
 * heading + content, so the sidebar stays still while the page changes. Enter
 * only: the App Router replaces the old page at once, and the cascade starts
 * straight away, never waiting on the page's data. Timing lives in
 * app/config/transitions.js.
 *
 * @param {{ className?: string, children: import('react').ReactNode }} props
 */
export default function PageTransition({ className, children }) {
  const columnRef = useRef(null);
  const reduceMotion = useReducedMotion();
  // Read once, on mount: whether this page arrived by navigation.
  const [navigatedTo] = useState(() => pageShown);

  // Before paint, so the cards never show at rest first.
  useLayoutEffect(() => {
    if (!navigatedTo || reduceMotion) return undefined;
    return cascadeCards(columnRef.current, PAGE_CASCADE);
  }, [navigatedTo, reduceMotion]);

  useEffect(() => {
    pageShown = true;
  }, []);

  return (
    <div ref={columnRef} className={className}>
      {children}
    </div>
  );
}
