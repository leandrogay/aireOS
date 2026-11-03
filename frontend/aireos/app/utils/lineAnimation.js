// Line chart draw-in, shared by the inventory sell-in outlook and the forecast
// chart. Every line is revealed by one left-to-right sweep across the chart:
// a line starts drawing when the sweep reaches its first point and finishes at
// its last, so lines that start or stop part-way (a forecast carrying on from
// its actuals) all move at one speed and meet where they join. Linear easing
// for the same reason: easing each line separately would make the pen slow
// down and restart at a join.

// Positions of the first and last row that have a value for `key`, or null.
function indexRange(rows, key) {
  const indexes = rows.flatMap((row, index) => (row[key] == null ? [] : [index]));
  return indexes.length ? { first: indexes[0], last: indexes[indexes.length - 1] } : null;
}

/**
 * Recharts <Line> animation props for each of `keys`, from one sweep that
 * starts after `begin` ms and crosses every row of the chart in `duration` ms.
 * Timed against the chart's rows, not the lines shown, so turning a line on or
 * off never re-times (and replays) the others. 'auto' skips the animation for
 * prefers-reduced-motion.
 *
 * @param {Array<object>} rows the chart's rows, in x order
 * @param {string[]} keys the lines' dataKeys
 * @param {{ begin: number, duration: number }} sweep
 * @returns {Record<string, { isAnimationActive: 'auto', animationBegin: number, animationDuration: number, animationEasing: 'linear' }>}
 */
export function lineSweepTimings(rows, keys, { begin, duration }) {
  const span = Math.max(rows.length - 1, 1);
  return Object.fromEntries(
    keys.map((key) => {
      const range = indexRange(rows, key);
      const first = range?.first ?? 0;
      const last = range?.last ?? first;
      return [
        key,
        {
          isAnimationActive: 'auto',
          animationBegin: begin + (duration * first) / span,
          animationDuration: Math.max((duration * (last - first)) / span, 1),
          animationEasing: 'linear',
        },
      ];
    }),
  );
}

/**
 * Delay in ms before a line's dot should appear: when the line reaches it.
 * Recharts draws a line's dots at once, ahead of the line, so they fade in
 * with .line-dot-in (globals.css) after this delay. `points` and `cx` are from
 * Recharts' dot props (the whole line, and this dot's x).
 *
 * @param {{ animationBegin: number, animationDuration: number }} timing from lineSweepTimings
 * @param {Array<{ x: number, y: number | null }>} points
 * @param {number} cx
 */
export function dotRevealDelay(timing, points, cx) {
  const drawn = points.filter((point) => point.y != null);
  const width = drawn.length > 1 ? drawn[drawn.length - 1].x - drawn[0].x : 0;
  const progress = width > 0 ? (cx - drawn[0].x) / width : 0;
  return Math.round(timing.animationBegin + timing.animationDuration * progress);
}
