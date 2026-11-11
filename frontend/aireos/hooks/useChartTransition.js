import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { animate, useReducedMotion } from 'motion/react';

import { CHART_TRANSITION } from '@/app/config/transitions';
import {
  blendSnapshots,
  chartSnapshot,
  hasDrawnValues,
  snapshotSignature,
  ticksWithin,
  withSnapshotValues,
} from '@/app/utils/chartTransition';

const NO_SERIES_ANIMATION = { isAnimationActive: false };
const OWN_SERIES_ANIMATION = {};

/**
 * Moves a chart from what it draws now to what it should draw, with its
 * y-axis on the same tween. Recharts animates bars and lines itself but
 * snaps the axis, so a rescale read as bars gliding under labels that jumped.
 * Here the values and the axis range are blended frame by frame (Motion), and
 * the chart draws each frame as-is: bars, lines, gridlines and tick labels
 * all move on one scale. The ticks are the new axis' own, shown once they
 * fall inside the moving range, so a label never reads an odd in-between
 * number.
 *
 * The first draw -- the first rows with any value, including after a load
 * that started empty -- keeps the chart's own Recharts animation (bars grow,
 * lines sweep); once a change has been tweened, spread `seriesAnimation` on every
 * series so Recharts doesn't also animate each frame. A change during a
 * change carries on from where the chart is. Reduced motion: no tween.
 * Timing lives in app/config/transitions.js.
 *
 * @param {{
 *   rows: Array<object>,
 *   rowKey: string,
 *   valueKeys: string[],
 *   domain: [number, number],
 *   ticks?: number[],
 * }} options `rowKey` names a row across changes (a month, a period label);
 *   `valueKeys` are the fields drawn (a number, a [low, high] range or null)
 * @returns {{ rows: Array<object>, domain: [number, number], ticks: number[] | undefined, seriesAnimation: object }}
 */
export default function useChartTransition({ rows, rowKey, valueKeys, domain, ticks }) {
  const reduceMotion = useReducedMotion();
  const target = chartSnapshot(rows, rowKey, valueKeys, domain);
  const signature = snapshotSignature(target);

  // What the chart rests on between transitions.
  const [settled, setSettled] = useState(() => ({ signature, snapshot: target }));
  // The latest frame of a running (or interrupted) transition, or null.
  const [frame, setFrame] = useState(null);
  const [tweened, setTweened] = useState(false);
  // The snapshot last drawn, where the next transition starts. Written only
  // from the animation's callbacks, never during render.
  const drawnRef = useRef(settled.snapshot);

  // Nothing was drawn before (rows still loading behind a skeleton, or none
  // for the filters), so the arriving rows are the chart's first draw, not a
  // change. Without this the load itself was tweened -- often while the
  // skeleton still showed -- and the lines then mounted with Recharts'
  // draw-in already switched off.
  // Adjusting state during render (not in the effect) so the first frame with
  // the rows is already the settled chart: rest on the new rows and hand the
  // draw-in back to Recharts (bars grow, lines sweep), also after an empty
  // state between two loads.
  const firstDraw = frame === null && signature !== settled.signature && !hasDrawnValues(settled.snapshot);
  if (firstDraw) {
    setSettled({ signature, snapshot: target });
    setTweened(false);
  }

  const startTransition = useEffectEvent(() => {
    if (frame === null && signature === settled.signature) return undefined;
    // Mid-transition, carry on from the last frame drawn; at rest, from the
    // settled chart (which a first draw sets during render, not the ref).
    const from = frame ? drawnRef.current : settled.snapshot;
    const controls = animate(0, 1, {
      ...(reduceMotion ? { duration: 0 } : CHART_TRANSITION),
      onUpdate: (t) => {
        const snapshot = blendSnapshots(from, target, t);
        drawnRef.current = snapshot;
        setFrame({ signature, snapshot });
        setTweened(true);
      },
      onComplete: () => {
        drawnRef.current = target;
        setFrame(null);
        setSettled({ signature, snapshot: target });
      },
    });
    return () => controls.stop();
  });

  useEffect(() => startTransition(), [signature]);

  // Until the transition's first frame, keep drawing where the chart was, with
  // the new rows' set: rows that arrive start at 0, rows that left are gone.
  let shown = target;
  if (firstDraw) shown = target;
  else if (frame) shown = frame.signature === signature ? frame.snapshot : blendSnapshots(frame.snapshot, target, 0);
  else if (settled.signature !== signature) shown = blendSnapshots(settled.snapshot, target, 0);

  const resting = shown === target;
  return {
    rows: resting ? rows : withSnapshotValues(rows, rowKey, shown),
    domain: shown.domain,
    ticks: resting ? ticks : ticksWithin(ticks, shown.domain),
    seriesAnimation: tweened ? NO_SERIES_ANIMATION : OWN_SERIES_ANIMATION,
  };
}
