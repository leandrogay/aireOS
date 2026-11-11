'use client';

import { useEffect, useRef } from 'react';
import { animate, useMotionValue } from 'motion/react';

// Size changes closer together than this are one continuous change (a row's
// details sliding open inside the table) rather than a step.
const CONTINUOUS_MS = 50;

/**
 * `maxHeight` in pixels: a number of `vh` ('28vh') is that share of the
 * window's height, anything else is read as pixels.
 *
 * @param {string | number} maxHeight
 * @returns {number}
 */
function maxHeightPx(maxHeight) {
  const text = String(maxHeight);
  if (text.endsWith('vh')) return (window.innerHeight * parseFloat(text)) / 100;
  return parseFloat(text);
}

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
 * `maxHeight` ('28vh', or pixels) caps the box, for a list shown collapsed
 * (ForecastTable's Expand / Collapse); give the box vertical scrolling while
 * it is capped. Changing the cap eases the box to its new height, so
 * expanding and collapsing slide rather than jump.
 *
 * A step (rows filtered, a new page, a new cap) eases on `transition`. A
 * change that keeps going frame after frame is already animating itself, so
 * the box keeps pace with it: chasing it on a spring would lag and clip its
 * bottom edge. The first measurement is just set. `enabled` false (reduced
 * motion, a fill table) leaves the box at its natural height.
 *
 * @param {{ enabled: boolean, transition: object, maxHeight?: string | number | null }} options
 * @returns {{ frameRef: import('react').RefObject<HTMLElement | null>, contentRef: import('react').RefObject<HTMLElement | null>, height: import('motion/react').MotionValue | undefined }}
 */
export default function useAnimatedHeight({ enabled, transition, maxHeight = null }) {
  const frameRef = useRef(null);
  const contentRef = useRef(null);
  const height = useMotionValue('auto');

  useEffect(() => {
    const frame = frameRef.current;
    const content = contentRef.current;
    if (!enabled || !frame || !content) {
      height.jump('auto');
      return undefined;
    }

    let animation = null;
    let lastChange = null;
    let lastTarget = null;
    // Already measured when only the cap changed (Expand / Collapse): ease
    // from the height on screen rather than set the new one.
    const measured = typeof height.get() === 'number';

    function follow() {
      const natural = content.offsetHeight + frame.offsetHeight - frame.clientHeight;
      const target = maxHeight == null ? natural : Math.min(natural, maxHeightPx(maxHeight));
      // Only the width changed (a vertical scrollbar showing as a capped box
      // shrinks past its rows): nothing to follow. Counting it as a change
      // would read as continuous and cut the ease short.
      if (target === lastTarget) return;
      lastTarget = target;
      const now = performance.now();
      const continuous = lastChange !== null && now - lastChange < CONTINUOUS_MS;
      const first = lastChange === null && !measured;
      lastChange = now;
      animation?.stop();
      if (first || continuous) {
        height.jump(target);
      } else {
        animation = animate(height, target, transition);
      }
    }

    // Observing calls follow once straight away: the first measurement.
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
    // A cap in vh follows the window's height.
    if (maxHeight != null) window.addEventListener('resize', follow);
    return () => {
      contentObserver.disconnect();
      frameObserver.disconnect();
      window.removeEventListener('resize', follow);
      animation?.stop();
    };
  }, [enabled, transition, maxHeight, height]);

  return { frameRef, contentRef, height: enabled ? height : undefined };
}
