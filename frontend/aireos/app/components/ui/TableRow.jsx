'use client';

import { motion, useReducedMotion } from 'motion/react';

import { rowMotionProps } from '@/components/ui/rowMotion';

/**
 * A `<tr>` of a TableGrid that animates when the rows change: it fades out
 * when a search or filter drops it, springs in when one brings it back, and
 * glides to its new place when rows around it come or go or the table is
 * re-sorted (rowMotion.js). Use it for every row a TableGrid lists -- a plain
 * `<tr>` still works, but it snaps while the rows around it move. Takes every
 * `<tr>` prop; give it the row's `key` as usual.
 *
 * @param {import('react').ComponentProps<'tr'>} props
 */
export default function TableRow(props) {
  const reduceMotion = useReducedMotion();
  return <motion.tr {...rowMotionProps(reduceMotion)} {...props} />;
}
