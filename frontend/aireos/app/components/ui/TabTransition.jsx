'use client';

import { useLayoutEffect, useRef } from 'react';
import { useReducedMotion } from 'motion/react';

import { TAB_CASCADE } from '@/app/config/transitions';
import { cascadeCards } from '@/lib/cardCascade';

/**
 * Wraps a set of tab panels; each time `value` (the active tab) changes, the
 * cards in the newly shown panel spring in one by one (lib/cardCascade.js), or
 * the panel itself when it has no card. It never remounts its children, so a
 * tab kept mounted and hidden (InventoryTabs' KeptTabPanel) keeps its fetched
 * data and filters. Nothing plays on first render (the page cascade covers
 * it), nor for users who ask for reduced motion. Timing lives in
 * app/config/transitions.js.
 *
 * @param {{ value: string, className?: string, children: import('react').ReactNode }} props
 */
export default function TabTransition({ value, className, children }) {
  const containerRef = useRef(null);
  const reduceMotion = useReducedMotion();
  const shownValue = useRef(value);

  // Before paint, so the new panel's cards never show at rest first.
  useLayoutEffect(() => {
    if (shownValue.current === value) return undefined;
    shownValue.current = value;
    if (reduceMotion) return undefined;
    return cascadeCards(containerRef.current, TAB_CASCADE);
  }, [value, reduceMotion]);

  return (
    <div ref={containerRef} className={className}>
      {children}
    </div>
  );
}
