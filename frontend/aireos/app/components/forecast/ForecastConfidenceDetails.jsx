'use client';

import { Fragment } from 'react';
import { AlertTriangle, CheckCircle2, CircleDashed, Info } from 'lucide-react';

import { cn } from '@/lib/utils';
import Disclosure from '@/components/ui/Disclosure';
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

// A figure column's cell: the band dot then the figure, left-aligned so the
// dots line up down the column. No band (no forecast for that line) is a
// dash in the same place.
function FigureCell({ band, label, text, title }) {
  if (!band) return <span className="text-deep-violet-blue/35">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 tabular-nums" title={title}>
      <BandDot band={band} label={label} />
      {text}
    </span>
  );
}

// "14%"; the column header and the cell's title say it is sMAPE, so each row
// doesn't repeat the word.
function smapeFigure(smape) {
  return smape == null ? 'n/a' : `${Math.round(smape)}%`;
}

// The rows grouped by customer, in the order each customer first
// appears, so All customers names each customer once above its SKUs.
function byCustomer(entries) {
  const groups = new Map();
  for (const entry of entries) {
    if (!groups.has(entry.customerName)) groups.set(entry.customerName, []);
    groups.get(entry.customerName).push(entry);
  }
  return [...groups.entries()];
}

// Up to this many rows are listed as they are; past it (All customers) the
// list would be taller than the screen.
const ROW_LIMIT = 10;

/**
 * Several SKUs' rows. Up to ROW_LIMIT they are all listed. Past it, the
 * promo panel (which can be clicked) folds them into a "Show" dropdown that
 * scrolls when open; the chart's own tooltip follows the pointer and can't
 * be clicked, so it lists the first ROW_LIMIT and says how many are left.
 */
function SkuConfidenceRows({ entries, showPrevious, interactive }) {
  if (entries.length <= ROW_LIMIT) return <SkuConfidenceTable entries={entries} showPrevious={showPrevious} />;
  if (interactive) {
    return (
      <Disclosure
        summary={<span className="tabular-nums">All {entries.length} SKUs</span>}
        className="-mx-2"
        summaryClassName="py-1"
      >
        <div className="max-h-64 overflow-y-auto px-2 pb-1">
          <SkuConfidenceTable entries={entries} showPrevious={showPrevious} />
        </div>
      </Disclosure>
    );
  }
  const more = entries.length - ROW_LIMIT;
  return (
    <>
      <SkuConfidenceTable entries={entries.slice(0, ROW_LIMIT)} showPrevious={showPrevious} />
      <p className="text-[10px] leading-snug text-deep-violet-blue/55">
        {more} more: pick one customer or SKU to see them all.
      </p>
    </>
  );
}

function SkuConfidenceTable({ entries, showPrevious }) {
  // All customers: the same SKU appears once per customer, so name them.
  const severalCustomers = new Set(entries.map((entry) => entry.customerName)).size > 1;
  // A Previous column only when some SKU has one this month.
  const withPrevious = showPrevious && entries.some((entry) => entry.previous);
  const currentLabel = withPrevious ? CURRENT_SERIES.label : THIS_MONTH_LABEL;
  // Likewise a Current column only when some SKU has one (a month the
  // Current run doesn't reach would be a column of dashes), so the names
  // get the room.
  const withCurrent = entries.some((entry) => entry.hasCurrent);
  const figureColumns = Number(withCurrent) + Number(withPrevious) + 1;
  // One grid for the header and every row (each a subgrid), so a column is
  // as wide as its widest cell and the figures and headers line up.
  const columns = {
    1: 'grid-cols-[minmax(0,1fr)_auto]',
    2: 'grid-cols-[minmax(0,1fr)_auto_auto]',
    3: 'grid-cols-[minmax(0,1fr)_auto_auto_auto]',
  }[figureColumns];
  // w-min lets a header wrap ("Past / accuracy") so the column is as wide
  // as its figures, not its label; left-aligned over the dots.
  const headClass = 'w-min';
  const rowClass = 'col-span-full grid grid-cols-subgrid items-center';
  return (
    <div>
      <div className={cn('grid gap-x-2.5', columns)}>
        <div
          className={cn(
            rowClass,
            'mb-0.5 items-end border-b border-lavander pb-0.5 text-[9px] leading-tight font-medium uppercase tracking-wide text-deep-violet-blue/45'
          )}
        >
          <span>SKU</span>
          {withCurrent ? <span className={headClass}>{currentLabel}</span> : null}
          {withPrevious ? <span className={headClass}>{PREVIOUS_SERIES.label}</span> : null}
          <span className={headClass} title="Average % error (sMAPE) on recent months hidden from the model">
            {PAST_ACCURACY_LABEL}
          </span>
        </div>
        {byCustomer(entries).map(([customerName, rows]) => (
          <Fragment key={customerName}>
            {severalCustomers ? (
              <span className="col-span-full mt-1 truncate text-[10px] font-semibold text-deep-violet-blue/55 first:mt-0">
                {customerLabel(customerName)}
              </span>
            ) : null}
            {rows.map((entry) => (
              // One line per SKU keeps the card short; a long name is cut off
              // with the full name in its title.
              <div key={entry.key ?? entry.sku} className={cn(rowClass, 'py-px')}>
                <span className="truncate" title={entry.productName}>
                  {entry.productName}
                </span>
                {withCurrent ? (
                  <FigureCell band={entry.monthBand} label={currentLabel} text={rangePctText(entry.monthRangePct) || '—'} />
                ) : null}
                {withPrevious ? (
                  <FigureCell
                    band={entry.previous?.band}
                    label={PREVIOUS_SERIES.label}
                    text={rangePctText(entry.previous?.rangePct) || '—'}
                  />
                ) : null}
                <FigureCell
                  band={entry.pastBand}
                  label={PAST_ACCURACY_LABEL}
                  text={smapeFigure(entry.smape)}
                  title={smapeText(entry.smape)}
                />
              </div>
            ))}
          </Fragment>
        ))}
      </div>
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
 * `interactive` adds the info icon, and folds more than ROW_LIMIT rows into
 * a dropdown: the chart's own tooltip follows the pointer and can't be
 * hovered, so only the promo panel shows them.
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
        <SkuConfidenceRows entries={visible} showPrevious={showPrevious} interactive={interactive} />
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
