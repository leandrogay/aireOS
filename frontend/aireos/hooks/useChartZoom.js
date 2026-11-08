'use client';

import { useState } from 'react';

/**
 * Drag-to-zoom for a Recharts chart with a category x-axis. Turn picking on
 * (the zoom button), then press on one point and release on another: the
 * range between them, both included, becomes the zoom. A click without
 * dragging picks that one point.
 *
 * `labels` are the x-axis values in order. The range is kept as labels, so
 * when the data changes (filters) and a label is gone, the zoom quietly
 * ends instead of pointing at the wrong months.
 *
 * Spread `chartHandlers` on the chart; draw `dragging` ({ from, to }) as a
 * ReferenceArea while it is set; slice the data with `start` / `end`
 * (indexes into `labels`, the whole axis when not zoomed).
 *
 * @param {string[]} labels
 */
export default function useChartZoom(labels) {
  const [picking, setPicking] = useState(false);
  const [dragging, setDragging] = useState(null);
  const [picked, setPicked] = useState(null);

  const pickedFrom = picked ? labels.indexOf(picked.from) : -1;
  const pickedTo = picked ? labels.indexOf(picked.to) : -1;
  const zoomed = pickedFrom !== -1 && pickedTo !== -1;

  function finish() {
    if (!dragging) return;
    const from = labels.indexOf(dragging.from);
    const to = labels.indexOf(dragging.to);
    setPicked({ from: labels[Math.min(from, to)], to: labels[Math.max(from, to)] });
    setDragging(null);
    setPicking(false);
  }

  // Recharts passes the hovered point's x value as `activeLabel`.
  const chartHandlers = picking
    ? {
        onMouseDown: (state) => {
          if (state?.activeLabel) setDragging({ from: state.activeLabel, to: state.activeLabel });
        },
        onMouseMove: (state, event) => {
          if (!state?.activeLabel) return;
          if (dragging) {
            setDragging({ ...dragging, to: state.activeLabel });
          } else if (event?.buttons === 1) {
            // Pressed before the chart knew which month the pointer was on
            // (no hover first): start from where it is now.
            setDragging({ from: state.activeLabel, to: state.activeLabel });
          }
        },
        onMouseUp: finish,
        onMouseLeave: () => setDragging(null),
      }
    : {};

  return {
    picking,
    zoomed,
    dragging,
    start: zoomed ? pickedFrom : 0,
    end: zoomed ? pickedTo : labels.length - 1,
    chartHandlers,
    startPicking: () => setPicking(true),
    cancelPicking: () => {
      setPicking(false);
      setDragging(null);
    },
    reset: () => setPicked(null),
  };
}
