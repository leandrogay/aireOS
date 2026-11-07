'use client';

import { ZoomIn, ZoomOut } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Round zoom button that sits in a chart's corner, driven by
 * hooks/useChartZoom: press it, then drag across the chart to zoom in. While
 * picking it says what to do and pressing it again cancels; once zoomed it
 * zooms back out. `align` 'end' (top-right corner) puts the hint on the
 * button's left, so it opens into the chart.
 *
 * @param {{ picking: boolean, zoomed: boolean, onPick: () => void, onCancel: () => void, onReset: () => void, align?: 'start' | 'end' }} props
 */
export default function ChartZoomButton({ picking, zoomed, onPick, onCancel, onReset, align = 'start' }) {
  const label = zoomed ? 'Zoom out' : picking ? 'Cancel zoom' : 'Zoom in';
  const Icon = zoomed ? ZoomOut : ZoomIn;
  return (
    <div className={cn('flex items-center gap-2', align === 'end' && 'flex-row-reverse')}>
      <button
        type="button"
        onClick={zoomed ? onReset : picking ? onCancel : onPick}
        aria-pressed={picking}
        aria-label={label}
        title={label}
        className={cn(
          'inline-flex size-8 items-center justify-center rounded-full border shadow-sm transition',
          picking
            ? 'border-deep-violet-blue bg-deep-violet-blue text-white'
            : 'border-lavander bg-cream text-deep-violet-blue hover:bg-white'
        )}
      >
        <Icon className="size-4" aria-hidden="true" />
      </button>
      {picking ? (
        <span className="rounded-md bg-white/90 px-2 py-0.5 text-[11px] text-deep-violet-blue shadow-sm" role="status">
          Drag across the months to zoom in, or click one month.
        </span>
      ) : null}
    </div>
  );
}
