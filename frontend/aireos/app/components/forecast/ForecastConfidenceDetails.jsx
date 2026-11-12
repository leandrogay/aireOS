'use client';

import { Fragment } from 'react';
import { AlertTriangle, CheckCircle2, CircleDashed, Info } from 'lucide-react';

import { cn } from '@/lib/utils';
import InfoTooltip from '@/components/ui/InfoTooltip';
import ForecastInfo from '@/components/forecast/ForecastInfo';
import SeriesDot from '@/components/forecast/SeriesDot';
import {
  CONFIDENCE_BAND_LABELS,
  CONFIDENCE_BANDS_INFO,
  CONFIDENCE_INFO,
  CONFIDENCE_DOT_FILL,
  INITIAL_CONFIDENCE_INFO,
  PAST_ACCURACY_LABEL,
  THIS_MONTH_LABEL,
  TYPICAL_PROMO_NOTE,
  confidenceWords,
  rangeChanceText,
  shownRangeLow,
  rangePctText,
  smapeText,
} from '@/app/utils/forecastLineText';
import { CONFIDENCE_ROW_LIMIT } from '@/app/utils/forecastTiers';
import { FORECAST_SERIES } from '@/app/utils/forecastView';
import { customerLabel } from '@/app/utils/retailerLabel';

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
      <span className="block">{INITIAL_CONFIDENCE_INFO}</span>
      <span className="block opacity-80">{CONFIDENCE_BANDS_INFO}</span>
    </span>
  );
}

const PREVIOUS_SERIES = FORECAST_SERIES.find((series) => series.key === 'previous');
const CURRENT_SERIES = FORECAST_SERIES.find((series) => series.key === 'current');
// "Initial Yearly Forecast" won't fit the row label column.
const INITIAL_SERIES = { ...FORECAST_SERIES.find((series) => series.key === 'initial'), label: 'Initial' };

/**
 * A line's confidence this month as the chart draws it: that line's dot
 * symbol (filled High, half Medium, hollow Low, small Unknown) and the words
 * ("Low confidence"), so the dots need no key under the chart.
 */
function DotConfidence({ band, series }) {
  return (
    <span className="inline-flex items-center gap-1 font-medium">
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="shrink-0">
        <SeriesDot cx={6} cy={6} color={series.color} shape={series.shape} fill={CONFIDENCE_DOT_FILL[band]} delay={0} />
      </svg>
      {confidenceWords(band)}
    </span>
  );
}

/** A line's chart symbol and name ("▲ Previous"), labelling its confidence row. */
function LineLabel({ series }) {
  return (
    <span className="inline-flex items-center gap-1">
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" className="shrink-0">
        <SeriesDot cx={5} cy={5} color={series.color} shape={series.shape} delay={0} />
      </svg>
      {series.label}
    </span>
  );
}

/**
 * One line's month: its band, "±30%", then the 8-in-10 range in figures. A
 * lower bound below 0 (ARIMA can give one for a small SKU) shows as 0: sales
 * can't be negative. `info` adds the ⓘ for the range (pinned card only).
 */
function MonthRange({ badge, rangePct, low, high, formatValue, info = false }) {
  const range = rangePctText(rangePct);
  const chance = rangeChanceText(
    low == null ? '' : formatValue(shownRangeLow(low)),
    high == null ? '' : formatValue(high)
  );
  return (
    <span className="space-y-0.5">
      <span className="flex flex-wrap items-center gap-1.5">
        {badge}
        {range ? <span className="font-medium tabular-nums">{range}</span> : null}
      </span>
      {chance ? (
        <span className="flex items-center gap-0.5 leading-snug text-deep-violet-blue/75">
          {chance}
          {info ? <ForecastInfo helpKey="range" label="About the 80% range" /> : null}
        </span>
      ) : null}
    </span>
  );
}

// The forecast lines with a month of confidence, in the order the hover card
// lists them: the line to plan on first, the yearly plan last.
function shownLines(entry, { showPrevious, showInitial }) {
  const lines = [];
  if (entry.hasCurrent) {
    lines.push({
      series: CURRENT_SERIES,
      band: entry.monthBand,
      rangePct: entry.monthRangePct,
      low: entry.low,
      high: entry.high,
    });
  }
  if (showPrevious && entry.previous) lines.push({ series: PREVIOUS_SERIES, ...entry.previous });
  if (showInitial && entry.initial) lines.push({ series: INITIAL_SERIES, ...entry.initial });
  return lines;
}

function SingleSkuConfidence({ entry, formatValue, dotSymbols, showPrevious, showInitial, interactive }) {
  const lines = shownLines(entry, { showPrevious, showInitial });
  // With several lines, each row is named by its line; Current alone keeps
  // the plain "This month" label it always had.
  const labelled = lines.length > 1 || !entry.hasCurrent;
  // Past accuracy is the model's backtest behind Current and Previous; a
  // month with only the yearly plan has no use for it.
  const showPast = entry.hasCurrent || (showPrevious && entry.previous);
  return (
    <div className="grid grid-cols-[5.5rem_1fr] gap-x-2 gap-y-1">
      {lines.map((line) => (
        <Fragment key={line.series.key}>
          <span className="flex items-start gap-0.5 pt-px text-[10px] text-deep-violet-blue/60">
            {labelled ? <LineLabel series={line.series} /> : THIS_MONTH_LABEL}
            {interactive && !labelled ? <ForecastInfo helpKey="monthConfidence" label="About this month's confidence" /> : null}
          </span>
          <MonthRange
            badge={dotSymbols ? <DotConfidence band={line.band} series={line.series} /> : <BandBadge band={line.band} />}
            rangePct={line.rangePct}
            low={line.low}
            high={line.high}
            formatValue={formatValue}
            info={interactive}
          />
        </Fragment>
      ))}
      {showPast ? (
        <>
          <span className="flex items-start gap-0.5 pt-px text-[10px] text-deep-violet-blue/60">
            {PAST_ACCURACY_LABEL}
            {interactive ? <ForecastInfo helpKey="accuracy" label="About past accuracy" /> : null}
          </span>
          <span className="flex flex-wrap items-center gap-1.5">
            <BandBadge band={entry.pastBand} />
            <span className="font-medium tabular-nums">{smapeText(entry.smape)}</span>
          </span>
        </>
      ) : null}
    </div>
  );
}

function RangeCell({ band, rangePct, label }) {
  if (!band) return <span className="text-right text-deep-violet-blue/40">—</span>;
  return (
    <span className="inline-flex items-center justify-end gap-1 tabular-nums">
      <BandDot band={band} label={label} />
      {rangePctText(rangePct) || '—'}
    </span>
  );
}

function SkuConfidenceRows({ entries, showPrevious }) {
  const shown = entries.slice(0, CONFIDENCE_ROW_LIMIT);
  const more = entries.length - shown.length;
  // All customers: the same SKU appears once per customer, so name them.
  const severalCustomers = new Set(entries.map((entry) => entry.customerName)).size > 1;
  const nameOf = (entry) =>
    severalCustomers ? `${entry.productName} · ${customerLabel(entry.customerName)}` : entry.productName;
  // A Previous column only when some SKU has one this month.
  const withPrevious = showPrevious && entries.some((entry) => entry.previous);
  const columns = withPrevious ? 'grid-cols-[1fr_auto_auto_auto]' : 'grid-cols-[1fr_auto_auto]';
  const currentLabel = withPrevious ? CURRENT_SERIES.label : THIS_MONTH_LABEL;
  return (
    <div className="space-y-0.5">
      <div className={cn('grid gap-x-2 text-[9px] uppercase tracking-wide text-deep-violet-blue/45', columns)}>
        <span />
        <span>{currentLabel}</span>
        {withPrevious ? <span>{PREVIOUS_SERIES.label}</span> : null}
        <span>{PAST_ACCURACY_LABEL}</span>
      </div>
      {shown.map((entry) => (
        <div key={entry.key ?? entry.sku} className={cn('grid items-center gap-x-2', columns)}>
          <span className="truncate" title={nameOf(entry)}>
            {nameOf(entry)}
          </span>
          <RangeCell band={entry.monthBand} rangePct={entry.monthRangePct} label={currentLabel} />
          {withPrevious ? (
            <RangeCell
              band={entry.previous?.band}
              rangePct={entry.previous?.rangePct}
              label={PREVIOUS_SERIES.label}
            />
          ) : null}
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
 * pointer and can't be hovered, so only the promo panel shows it.
 * `dotSymbols` (one SKU and customer on /forecast, where the Current and
 * Previous dots show their bands) puts each line's dot symbol and "Low
 * confidence" in place of its badge. `showPrevious` (the Previous line is on) adds Previous's
 * own band and 80% range beside Current's; past accuracy stays one score,
 * the model's, which made both lines. `showInitial` (the Initial line is on)
 * adds the yearly plan's band and range, for one SKU only: the several-SKU
 * rows keep to Current and Previous so they stay readable.
 *
 * @param {{
 *   entries: Array<ReturnType<typeof import('@/app/utils/forecastTiers').confidenceEntry>>,
 *   formatValue: (value: number) => string,
 *   interactive?: boolean,
 *   dotSymbols?: boolean,
 *   showPrevious?: boolean,
 *   showInitial?: boolean,
 *   className?: string,
 * }} props
 */
export default function ForecastConfidenceDetails({
  entries,
  formatValue,
  interactive = false,
  dotSymbols = false,
  showPrevious = false,
  showInitial = false,
  className,
}) {
  // A month whose only forecasts are switched-off lines has nothing to show.
  const withLine = (entries ?? []).filter(
    (entry) => entry.hasCurrent || (showPrevious && entry.previous) || (showInitial && entry.initial)
  );
  const single = withLine.length === 1 ? withLine[0] : null;
  const visible = single ? withLine : withLine.filter((entry) => entry.hasCurrent || (showPrevious && entry.previous));
  if (!visible.length) return null;
  const typicalPromo = visible.some((entry) => entry.typicalPromo);
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
      {single ? (
        <SingleSkuConfidence
          entry={single}
          formatValue={formatValue}
          dotSymbols={dotSymbols}
          showPrevious={showPrevious}
          showInitial={showInitial}
          interactive={interactive}
        />
      ) : (
        <SkuConfidenceRows entries={visible} showPrevious={showPrevious} />
      )}
      {typicalPromo ? (
        <p className="flex items-start gap-0.5 text-[10px] leading-snug text-deep-violet-blue/55">
          {TYPICAL_PROMO_NOTE}
          {interactive ? <ForecastInfo helpKey="typicalPromo" label="About the unfamiliar promotion" /> : null}
        </p>
      ) : null}
    </div>
  );
}
