'use client';

import { useState } from 'react';
import { RefreshCw } from 'lucide-react';

import { cn } from '@/lib/utils';
import { BAND_STYLES } from '@/components/forecast/ForecastConfidenceDetails';
import {
  FORECAST_LAST_UPDATED_LABEL,
  PAST_ACCURACY_BADGE_HINT,
  pastAccuracyBadgeLabel,
} from '@/app/utils/forecastLineText';
import { formatSgtTimestamp } from '@/app/utils/forecastView';

/**
 * "Past accuracy: High · sMAPE 12%" for one SKU on the selected model, with
 * why it isn't like-for-like across tiers on hover, focus or tap.
 */
function PastAccuracyBadge({ pastAccuracy }) {
  const [open, setOpen] = useState(false);
  const { className, Icon } = BAND_STYLES[pastAccuracy.band] ?? BAND_STYLES.unknown;

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
        {pastAccuracyBadgeLabel(pastAccuracy)}
      </button>
      {open ? (
        <span
          role="tooltip"
          className="absolute bottom-full left-1/2 z-40 mb-1.5 w-64 -translate-x-1/2 rounded-md border border-lavander bg-white px-2.5 py-2 text-left text-[11px] leading-snug text-deep-violet-blue shadow-md"
        >
          {PAST_ACCURACY_BADGE_HINT}
        </span>
      ) : null}
    </span>
  );
}

/**
 * "Forecast updating…" pill beside the last-updated stamp, with its
 * explanation on hover or keyboard focus (same tooltip pattern as the line
 * pills). `badge` comes from forecastUpdatingBadge.
 */
function UpdatingBadge({ badge }) {
  return (
    <span className="group relative inline-flex">
      <span
        tabIndex={0}
        aria-describedby="forecast-updating-hint"
        className="inline-flex items-center gap-1 rounded-full border border-lavander bg-cream px-2 py-0.5 text-[11px] font-medium text-deep-violet-blue"
      >
        <RefreshCw aria-hidden="true" className="size-3 shrink-0" />
        {badge.label}
      </span>
      <span
        id="forecast-updating-hint"
        role="tooltip"
        className="pointer-events-none invisible absolute bottom-full left-1/2 z-40 mb-1.5 w-64 -translate-x-1/2 rounded-md border border-lavander bg-white px-2.5 py-2 text-left text-[11px] leading-snug text-deep-violet-blue opacity-0 shadow-md transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100"
      >
        {badge.hint}
      </span>
    </span>
  );
}

/**
 * Centred line in the chart box, under the graph: when the selected model
 * last updated (MAX(current_generated_at) for that tier -- every retrain
 * replaces the Current line, so this is the latest retrain), when that
 * customer's sales last loaded (latest_sales_loaded_at; see backend
 * bigquery.get_sales_loaded_at) and, for one customer + SKU, the model's
 * Past accuracy badge. How to read confidence, and what each Current dot
 * means, live in the hover card's CONFIDENCE section.
 * `updatingBadge` (forecastUpdatingBadge) shows while a refresh is pending;
 * `notes` (Initial status, Initial / Previous coverage) are one line each
 * under that row.
 *
 * @param {{
 *   lastRun?: string | null,
 *   salesLabel: string,
 *   salesLoadedAt?: string | null,
 *   pastAccuracy?: { band: string, smape: number | null } | null,
 *   updatingBadge?: { label: string, hint: string } | null,
 *   notes?: string[],
 *   className?: string,
 * }} props
 */
export default function ForecastLegendFooter({
  lastRun,
  salesLabel,
  salesLoadedAt,
  pastAccuracy = null,
  updatingBadge = null,
  notes = [],
  className,
}) {
  return (
    <div className={cn('space-y-0.5', className)}>
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-deep-violet-blue">
        <span>
          <span className="text-ink-soft">{FORECAST_LAST_UPDATED_LABEL}: </span>
          <span className="font-medium">{formatSgtTimestamp(lastRun)}</span>
        </span>
        {updatingBadge ? <UpdatingBadge badge={updatingBadge} /> : null}
        <span aria-hidden="true" className="text-deep-violet-blue/40">·</span>
        <span>
          <span className="text-ink-soft">{salesLabel}: </span>
          <span className="font-medium">{formatSgtTimestamp(salesLoadedAt)}</span>
        </span>
        {pastAccuracy ? (
          <>
            <span aria-hidden="true" className="h-3 w-px bg-lavander" />
            <PastAccuracyBadge pastAccuracy={pastAccuracy} />
          </>
        ) : null}
      </div>
      {notes.map((note) => (
        <p key={note} className="text-center text-[11px] text-ink-soft">
          {note}
        </p>
      ))}
    </div>
  );
}
