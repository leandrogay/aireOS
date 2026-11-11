'use client';

import { useEffect, useRef } from 'react';
import { animate, useMotionValue } from 'motion/react';

// Size changes closer together than this are one continuous change (a row's
// details sliding open inside the table) rather than a step.
const CONTINUOUS_MS = 50;

/**
 * Makes a box ease to its content's height instead of snapping, for a list
 * that isn't held at a fixed height (DataTable without `fill`): rows coming or
 * going would otherwise make the card -- and everything under it -- jump.
 *
 * Put `frameRef` and `style={{ height }}` on the box (a motion element, with
 * its vertical overflow hidden) and `contentRef` on its only child. The box
 * follows the child's height plus the box's own borders and scrollbar
 * (offsetHeight - clientHeight), so a horizontal scrollbar is never cut off.
 *
 * A step (rows filtered, a new page) eases on `transition`. A change that
 * keeps going frame after frame is already animating itself, so the box keeps
 * pace with it: chasing it on a spring would lag and clip its bottom edge.
 * The first measurement is just set. `enabled` false (reduced motion, a fill
 * table) leaves the box at its natural height.
 *
 * @param {{ enabled: boolean, transition: object }} options
 * @returns {{ frameRef: import('react').RefObject<HTMLElement | null>, contentRef: import('react').RefObject<HTMLElement | null>, height: import('motion/react').MotionValue | undefined }}
 */
export default function useAnimatedHeight({ enabled, transition }) {
  const frameRef = useRef(null);
  const contentRef = useRef(null);
  const height = useMotionValue('auto');

  useEffect(() => {
    const frame = frameRef.current;
    const content = contentRef.current;
    if (!enabled || !frame || !content) return undefined;

    let animation = null;
    let lastChange = null;

    function follow() {
      const target = content.offsetHeight + frame.offsetHeight - frame.clientHeight;
      const now = performance.now();
      const continuous = lastChange !== null && now - lastChange < CONTINUOUS_MS;
      const first = lastChange === null;
      lastChange = now;
      animation?.stop();
      if (first || continuous) {
        height.jump(target);
      } else {
        animation = animate(height, target, transition);
      }
    }

    const contentObserver = new ResizeObserver(follow);
    contentObserver.observe(content);
    // The box's width decides whether a horizontal scrollbar shows. Its
    // height is ours (and changes every frame while it eases), so only a
    // width change counts.
    let frameWidth = frame.offsetWidth;
    const frameObserver = new ResizeObserver(() => {
      if (frame.offsetWidth === frameWidth) return;
      frameWidth = frame.offsetWidth;
      follow();
    });
    frameObserver.observe(frame);
    return () => {
      contentObserver.disconnect();
      frameObserver.disconnect();
      animation?.stop();
      height.jump('auto');
    };
  }, [enabled, transition, height]);

  return { frameRef, contentRef, height: enabled ? height : undefined };
}
