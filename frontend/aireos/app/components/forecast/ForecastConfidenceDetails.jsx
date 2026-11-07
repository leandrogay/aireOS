'use client';

import { AlertTriangle, CheckCircle2, CircleDashed, Info } from 'lucide-react';

import { cn } from '@/lib/utils';
import InfoTooltip from '@/components/ui/InfoTooltip';
import {
  CONFIDENCE_BAND_LABELS,
  CONFIDENCE_BANDS_INFO,
  CONFIDENCE_INFO,
  PAST_ACCURACY_LABEL,
  THIS_MONTH_LABEL,
  TYPICAL_PROMO_NOTE,
  rangeChanceText,
  rangePctText,
  smapeText,
} from '@/app/utils/forecastLineText';
import { CONFIDENCE_ROW_LIMIT } from '@/app/utils/forecastTiers';

// Colour is a second channel only: every badge also carries an icon and a
// word, so the band survives greyscale and colour blindness.
export const BAND_STYLES = {
  high: { className: 'border-green-300 bg-green-50 text-green-800', dot: 'bg-green-600', Icon: CheckCircle2 },
  medium: { className: 'border-amber-400 bg-amber-50 text-amber-900', dot: 'bg-amber-500', Icon: Info },
  low: { className: 'border-red-300 bg-red-50 text-red-800', dot: 'bg-red-600', Icon: AlertTriangle },
  unknown: { className: 'border-lavander bg-cream text-deep-violet-blue/70', dot: 'bg-deep-violet-blue/30', Icon: CircleDashed },
};

/** A band as a small pill: icon + word ("High"). */
export function BandBadge({ band, className }) {
  const { className: bandClass, Icon } = BAND_STYLES[band] ?? BAND_STYLES.unknown;
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-px text-[10px] font-medium',
        bandClass,
        className
      )}
    >
      <Icon aria-hidden="true" className="size-2.5 shrink-0" />
      {CONFIDENCE_BAND_LABELS[band] ?? CONFIDENCE_BAND_LABELS.unknown}
    </span>
  );
}

// A band as a dot plus its word for screen readers, for the compact rows.
function BandDot({ band, label }) {
  const { dot } = BAND_STYLES[band] ?? BAND_STYLES.unknown;
  return (
    <span className={cn('size-2 shrink-0 rounded-full', dot)} title={`${label}: ${CONFIDENCE_BAND_LABELS[band]}`}>
      <span className="sr-only">
        {label}: {CONFIDENCE_BAND_LABELS[band]}
      </span>
    </span>
  );
}

/** The explanation behind the CONFIDENCE header's info icon (and the legend's). */
export function ConfidenceHelp() {
  return (
    <span className="block space-y-1">
      <span className="block">{CONFIDENCE_INFO}</span>
      <span className="block opacity-80">{CONFIDENCE_BANDS_INFO}</span>
    </span>
  );
}

function SingleSkuConfidence({ entry, formatValue }) {
  const range = rangePctText(entry.monthRangePct);
  const chance = rangeChanceText(
    entry.low == null ? '' : formatValue(entry.low),
    entry.high == null ? '' : formatValue(entry.high)
  );
  return (
    <div className="grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-1">
      <span className="pt-px text-[10px] text-deep-violet-blue/60">{THIS_MONTH_LABEL}</span>
      <span className="space-y-0.5">
        <span className="flex flex-wrap items-center gap-1.5">
          <BandBadge band={entry.monthBand} />
          {range ? <span className="font-medium tabular-nums">{range}</span> : null}
        </span>
        {chance ? <span className="block leading-snug text-deep-violet-blue/75">{chance}</span> : null}
      </span>
      <span className="pt-px text-[10px] text-deep-violet-blue/60">{PAST_ACCURACY_LABEL}</span>
      <span className="flex flex-wrap items-center gap-1.5">
        <BandBadge band={entry.pastBand} />
        <span className="font-medium tabular-nums">{smapeText(entry.smape)}</span>
      </span>
    </div>
  );
}

function SkuConfidenceRows({ entries }) {
  const shown = entries.slice(0, CONFIDENCE_ROW_LIMIT);
  const more = entries.length - shown.length;
  return (
    <div className="space-y-0.5">
      <div className="grid grid-cols-[1fr_auto_auto] gap-x-2 text-[9px] uppercase tracking-wide text-deep-violet-blue/45">
        <span />
        <span>{THIS_MONTH_LABEL}</span>
        <span>{PAST_ACCURACY_LABEL}</span>
      </div>
      {shown.map((entry) => (
        <div key={entry.sku} className="grid grid-cols-[1fr_auto_auto] items-center gap-x-2">
          <span className="truncate" title={entry.productName}>
            {entry.productName}
          </span>
          <span className="inline-flex items-center justify-end gap-1 tabular-nums">
            <BandDot band={entry.monthBand} label={THIS_MONTH_LABEL} />
            {rangePctText(entry.monthRangePct) || '—'}
          </span>
          <span className="inline-flex items-center justify-end gap-1 tabular-nums">
            <BandDot band={entry.pastBand} label={PAST_ACCURACY_LABEL} />
            {smapeText(entry.smape)}
          </span>
        </div>
      ))}
      {more > 0 ? <p className="text-[10px] text-deep-violet-blue/55">+{more} more</p> : null}
    </div>
  );
}

/**
 * CONFIDENCE section of a forecast month's hover card: for each SKU, how wide
 * this month's 80% range is (month_confidence_band / month_range_pct) and how
 * accurate the model was in its backtest (current_confidence_band / sMAPE).
 * The two are shown side by side, never combined. One SKU gets both lines in
 * full; several get one compact row each and no summed range. Nothing on a
 * month with no forecast (`entries` empty).
 *
 * `interactive` adds the info icon: the chart's own tooltip follows the
 * pointer and can't be hovered, so only the promo panel shows it (the legend
 * under the chart has the same help).
 *
 * @param {{
 *   entries: Array<ReturnType<typeof import('@/app/utils/forecastTiers').confidenceEntry>>,
 *   formatValue: (value: number) => string,
 *   interactive?: boolean,
 *   className?: string,
 * }} props
 */
export default function ForecastConfidenceDetails({ entries, formatValue, interactive = false, className }) {
  if (!entries?.length) return null;
  const typicalPromo = entries.some((entry) => entry.typicalPromo);
  return (
    <div className={cn('space-y-1 text-[11px] text-deep-violet-blue', className)}>
      <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-deep-violet-blue/45">
        Confidence
        {interactive ? (
          <InfoTooltip label="How to read confidence">
            <ConfidenceHelp />
          </InfoTooltip>
        ) : null}
      </p>
      {entries.length === 1 ? (
        <SingleSkuConfidence entry={entries[0]} formatValue={formatValue} />
      ) : (
        <SkuConfidenceRows entries={entries} />
      )}
      {typicalPromo ? <p className="text-[10px] leading-snug text-deep-violet-blue/55">{TYPICAL_PROMO_NOTE}</p> : null}
    </div>
  );
}
