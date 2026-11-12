'use client';

import { Children } from 'react';
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'motion/react';

import { LIST_MOTION_PROPS } from '@/components/ui/rowMotion';

/**
 * The phone view of a list table (DataTable `mobileContent`): a column of
 * MobileRecordCards that animate like the table's rows -- ones a search drops
 * fade out and the rest glide up, ones it brings back spring in, and a new
 * list (the first load, a new page through DataTable's `pageKey`) cascades in
 * top to bottom. Give each card its `key` as usual. Reduced motion: none.
 *
 * @param {{ children: import('react').ReactNode }} props
 */
export default function RecordCardList({ children }) {
  const reduceMotion = useReducedMotion();

  if (reduceMotion) return <div className="grid gap-2">{children}</div>;

  // LayoutGroup and toArray: see TableGrid's <tbody>.
  return (
    <LayoutGroup>
      <motion.div className="grid gap-2" {...LIST_MOTION_PROPS}>
        <AnimatePresence>{Children.toArray(children)}</AnimatePresence>
      </motion.div>
    </LayoutGroup>
  );
}
