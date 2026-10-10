'use client';

import { useState } from 'react';
import { AlertTriangle, CheckCircle2, CircleDashed, Info } from 'lucide-react';

import { cn } from '@/lib/utils';
import { formatSgtTimestamp } from '@/app/utils/forecastView';

// Colour is a second channel only: every badge also carries an icon and a
// word, so the band survives greyscale and colour blindness.
const BAND_STYLES = {
  high: { className: 'border-green-300 bg-green-50 text-green-800', Icon: CheckCircle2 },
  medium: { className: 'border-amber-400 bg-amber-50 text-amber-900', Icon: Info },
  low: { className: 'border-red-300 bg-red-50 text-red-800', Icon: AlertTriangle },
  unknown: { className: 'border-lavander bg-cream text-deep-violet-blue/70', Icon: CircleDashed },
};

function ConfidenceBadge({ confidence }) {
  const [open, setOpen] = useState(false);
  const { className, Icon } = BAND_STYLES[confidence.band] ?? BAND_STYLES.unknown;

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-expanded={open}
        // Click/tap/Enter opens (not toggles): on touch and mouse, the
        // emulated hover has already opened it, so a toggle would close it.
        onClick={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className={cn(
          'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium',
          className
        )}
      >
        <Icon aria-hidden="true" className="size-3 shrink-0" />
        <span>
          Confidence: {confidence.label}
          <span className="font-normal opacity-80"> ({confidence.reason})</span>
        </span>
      </button>
      {open ? (
        <span
          role="tooltip"
          className="absolute bottom-full left-1/2 z-40 mb-1.5 w-64 -translate-x-1/2 rounded-md border border-lavander bg-white px-2.5 py-2 text-left text-[11px] leading-snug text-deep-violet-blue shadow-md"
        >
          {confidence.detail}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Centred line in the chart box, under the graph: when the pipeline last produced the Current
 * forecast (MAX(current_generated_at) for the customer), when that
 * customer's sales last loaded (latest_sales_loaded_at; see backend
 * get_forecast_freshness) and, for one customer + SKU, the confidence badge.
 * "Current" matches the line's name in the toggles above the chart.
 *
 * @param {{
 *   lastRun?: string | null,
 *   salesLabel: string,
 *   salesLoadedAt?: string | null,
 *   confidence?: object | null,
 *   className?: string,
 * }} props
 */
export default function ForecastLegendFooter({ lastRun, salesLabel, salesLoadedAt, confidence, className }) {
  return (
    <div className={cn('flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-deep-violet-blue', className)}>
      <span>
        <span className="text-deep-violet-blue/55">Last Updated (Current): </span>
        <span className="font-medium">{formatSgtTimestamp(lastRun)}</span>
      </span>
      <span aria-hidden="true" className="text-deep-violet-blue/40">·</span>
      <span>
        <span className="text-deep-violet-blue/55">{salesLabel}: </span>
        <span className="font-medium">{formatSgtTimestamp(salesLoadedAt)}</span>
      </span>
      {confidence ? (
        <>
          <span aria-hidden="true" className="h-3 w-px bg-lavander" />
          <ConfidenceBadge confidence={confidence} />
        </>
      ) : null}
    </div>
  );
}
