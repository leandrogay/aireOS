'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Area, ComposedChart, Line, ReferenceArea, ReferenceDot, ReferenceLine, XAxis, YAxis } from 'recharts';

import { cn } from '@/lib/utils';
import { glassInsetClass } from '@/components/ui/surfaceStyles';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import ChartCard from '@/components/ui/ChartCard';
import ChartFrame, { CHART_FRAME_CLASS, CHART_TOOLTIP_CLASS } from '@/components/ui/ChartFrame';
import ChartLoading from '@/components/ui/ChartLoading';
import LineChartSkeleton from '@/components/ui/LineChartSkeleton';
import LineToggle from '@/components/ui/LineToggle';
import { Skeleton } from '@/components/ui/skeleton';
import ForecastConfidenceDetails from '@/components/forecast/ForecastConfidenceDetails';
import ForecastPointDetails from '@/components/forecast/ForecastPointDetails';
import ForecastPromoPanel from '@/components/forecast/ForecastPromoPanel';
import ForecastPromoToggle from '@/components/forecast/ForecastPromoToggle';
import SeriesDot from '@/components/forecast/SeriesDot';
import ForecastLegendFooter from '@/components/forecast/ForecastLegendFooter';
import {
  FORECAST_SERIES,
  buildPromoOverlayBands,
  forecastPointDetails,
  formatAxisValue,
  formatMonthLabel,
  formatTooltipValue,
  niceYDomain,
  nextMonthYear,
  padMonthlyPoints,
  promoPeriodDividerXs,
  promosOverlappingMonth,
} from '@/app/utils/forecastView';
import { withActualBridges } from '@/app/utils/forecastActuals';
import { CURRENT_DOT_FILL, INITIAL_MISSING_HINT, forecastLineHints } from '@/app/utils/forecastLineText';
import { dotRevealDelay, lineSweepTimings } from '@/app/utils/lineAnimation';
import { AXIS_TICK, yearAxisProps } from '@/app/utils/trendChart';
import useChartTransition from '@/hooks/useChartTransition';
import useDelayedLoading from '@/hooks/useDelayedLoading';
import useMediaQuery from '@/hooks/useMediaQuery';

// All lines draw in with one left-to-right sweep (see lineSweepTimings), so
// Actual, Initial and Current reach each month together. The promo bands wipe
// in with the same sweep (PromoBands).
const LINE_SWEEP = { begin: 0, duration: 1200 };

// How long a promo band takes to wipe in when it is added after the first draw.
const LATE_BAND_MS = 300;

// Room for carton ticks ("1.5k"); the chart is volume only.
const Y_AXIS_WIDTH = 40;

const chartConfig = Object.fromEntries(
  FORECAST_SERIES.map((series) => [series.key, { label: series.label, color: series.color }])
);

const ACTUAL_COLOR = FORECAST_SERIES.find((series) => series.key === 'actual')?.color;

function dotFill(seriesKey, payload, confidenceDots) {
  if (seriesKey === 'actual' && payload?.actualKind === 'partial') return 'hollow';
  if (seriesKey === 'current' && confidenceDots && payload?.currentBand) return CURRENT_DOT_FILL[payload.currentBand];
  return 'filled';
}

function OverlayDefs({ bands }) {
  return (
    <defs>
      {bands
        .filter((band) => band.colors.length > 1)
        .map((band) => (
          <linearGradient
            key={band.key}
            id={band.key}
            x1="0"
            y1="0"
            x2="0"
            y2="1"
            gradientUnits="objectBoundingBox"
          >
            {band.colors.flatMap((color, index) => {
              const start = (index / band.colors.length) * 100;
              const end = ((index + 1) / band.colors.length) * 100;
              return [
                <stop key={`${band.key}-${index}-start`} offset={`${start}%`} stopColor={color} />,
                <stop key={`${band.key}-${index}-end`} offset={`${end}%`} stopColor={color} />,
              ];
            })}
          </linearGradient>
        ))}
    </defs>
  );
}

/**
 * The promo bands behind the lines. On the chart's first draw each band wipes
 * in left to right as the line sweep passes it: it starts at its left edge's
 * moment and finishes at its right edge's, so the leading edge keeps pace with
 * the lines. A band added later (a promo filter turned on) just wipes in
 * quickly, rather than waiting for a sweep that is not happening. This mounts
 * with the chart, so `settled` starts over whenever the chart is redrawn.
 *
 * @param {{ bands: Array<{ key: string, x1: number, x2: number, colors: string[], fillOpacity: number }>, span: number }} props
 *   `span` is the x-axis length in months, what the sweep crosses
 */
function PromoBands({ bands, span }) {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(true), LINE_SWEEP.begin + LINE_SWEEP.duration);
    return () => clearTimeout(timer);
  }, []);

  return bands.map((band) => {
    const timing = settled
      ? { delay: 0, duration: LATE_BAND_MS }
      : {
          delay: LINE_SWEEP.begin + (LINE_SWEEP.duration * band.x1) / span,
          duration: (LINE_SWEEP.duration * (band.x2 - band.x1)) / span,
        };
    return (
      <ReferenceArea
        key={band.key}
        x1={band.x1}
        x2={band.x2}
        fill={band.colors.length > 1 ? `url(#${band.key})` : band.colors[0]}
        fillOpacity={band.fillOpacity}
        stroke="none"
        ifOverflow="visible"
        // Recharts passes the band's drawn rectangle; the shape is only here
        // to put the wipe (.promo-band-in) on it.
        shape={({ x, y, width, height, fill, fillOpacity }) => (
          <rect
            x={x}
            y={y}
            width={width}
            height={height}
            fill={fill}
            fillOpacity={fillOpacity}
            className="promo-band-in"
            style={{ animationDelay: `${Math.round(timing.delay)}ms`, animationDuration: `${Math.round(timing.duration)}ms` }}
          />
        )}
      />
    );
  });
}

function ScopeTag({ label, value }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-lavander bg-lavander/70 px-2.5 py-0.5 text-[11px] text-deep-violet-blue">
      <span className="font-semibold uppercase tracking-wide text-deep-violet-blue/45">{label}</span>
      {value}
    </span>
  );
}

const PROMO_PANEL_WIDTH = 304;
const PROMO_PANEL_EDGE = 8;

// Sit to the right of the cursor; clamp if it would run off the chart.
function promoPanelLeft(originX, wrapWidth) {
  let left = originX + 12;
  const maxLeft = wrapWidth ? wrapWidth - PROMO_PANEL_WIDTH - PROMO_PANEL_EDGE : left;
  return Math.max(PROMO_PANEL_EDGE, Math.min(left, maxLeft));
}

// The Scenario builder's switched-on items, one group per source, in the
// order the panel's tabs show them.
const SCENARIO_ITEM_GROUPS = [
  { source: 'blocks', title: 'Building blocks added' },
  { source: 'promotions', title: 'Planned promotions added' },
];

// Scenario section of the hover card (and of the entered-promotions panel,
// which replaces the card in months with an entered promotion): how far
// Simulated sits from Current this month, and every switched-on building
// block and planned promotion in it, even one that adds 0%. With
// `hasEntered`, planned promotions are added on top of the month's entered
// ones (scenarioPromotions.stackedModelCells), so the card says so.
function ScenarioPointDetails({ point, items, formatValue, hasEntered = false, className }) {
  if (point?.simulated == null || point.current == null) return null;
  const delta = point.simulated - point.current;
  if (!delta && !items.length) return null;
  const pct = point.current ? ` (${delta < 0 ? '−' : '+'}${Math.abs((delta / point.current) * 100).toFixed(1)}%)` : '';
  // Sign written here, figure unsigned, so it reads "+2,555".
  const signed = (value) => `${value < 0 ? '−' : '+'}${formatValue(Math.abs(value))}`;
  return (
    <div className={cn('space-y-0.5 text-[11px] tabular-nums', className)}>
      <div className="flex justify-between gap-3">
        <span>Difference from Current</span>
        <span className="font-semibold text-scenario-ink">
          {signed(delta)}
          {pct}
        </span>
      </div>
      {SCENARIO_ITEM_GROUPS.map((group) => {
        const groupItems = items.filter((item) => item.source === group.source);
        if (!groupItems.length) return null;
        return (
          <div key={group.source}>
            <p className="pt-1 text-[10px] font-semibold uppercase tracking-wide text-deep-violet-blue/50">
              {group.title}
            </p>
            {groupItems.map((item) => (
              <div key={item.itemId} className="flex justify-between gap-3">
                <span className="truncate">{item.name}</span>
                <span className="font-semibold text-scenario-ink">{signed(item.deltaUnits)}</span>
              </div>
            ))}
            {group.source === 'promotions' && hasEntered ? (
              <p className="text-[10px] text-deep-violet-blue/60">On top of the entered promotions below.</p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export default function ForecastChart({
  points,
  startDate,
  endDate,
  singleSeries,
  scopeTags,
  promotions,
  selectedPromoTypes,
  onTogglePromoType,
  selectedPackTypes,
  onTogglePackType,
  visibleSeries,
  onToggleSeries,
  lastRun,
  salesLabel,
  salesLoadedAt,
  pastAccuracy = null,
  updatingBadge = null,
  initialNotes = [],
  // /forecast only: why the selected model has no Initial / no Previous for
  // any SKU in scope (greys out that pill; per SKU and tier, from the
  // page). undefined falls back to "no value in view". `confidenceDots`
  // draws the Current dots by this month's confidence (one SKU and
  // customer). `notes` are extra lines under the legend, `emptyMessage`
  // replaces the no-data text.
  initialMissingHint,
  previousMissing,
  confidenceDots = false,
  notes = [],
  emptyMessage = 'No forecast data matches these filters.',
  loading = false,
  scenario = null,
  // Scenario builder only (all default off): `toolbar` renders under the
  // card header, `summary` right under the chart, `yearTable` under that.
  // /forecast shows its year totals and monthly table as cards of their own
  // under this one, never inside it. Both pages are volume only (cartons):
  // there is no revenue view.
  toolbar = null,
  summary = null,
  yearTable = null,
}) {
  const mobile = useMediaQuery('(max-width: 639px)');
  const chartWrapRef = useRef(null);
  const overPanelRef = useRef(false);
  const lastPointerXRef = useRef(0);
  const hoverMonthRef = useRef(null);
  const [hoverMonth, setHoverMonth] = useState(null);
  const [openPromoId, setOpenPromoId] = useState(null);
  const [panelX, setPanelX] = useState(0);
  const [wrapWidth, setWrapWidth] = useState(0);

  // The Scenario builder adds its Simulated line (and pins, draft promo
  // bands, seasonal average) through `scenario`; /forecast passes nothing,
  // so it draws exactly the committed lines. All values arrive precomputed
  // (app/utils/scenarioEngine.js); this component only draws them.
  const allSeries = scenario ? [...FORECAST_SERIES, ...scenario.series] : FORECAST_SERIES;
  const config = scenario
    ? {
        ...chartConfig,
        ...Object.fromEntries(scenario.series.map((series) => [series.key, { label: series.label, color: series.color }])),
      }
    : chartConfig;
  // A line the selected model has for none of the SKUs in scope: its pill
  // is greyed out (its hover says why) and the line and table column stay off.
  const previousOff = previousMissing ?? !points.some((point) => point.previous != null);
  const initialOffHint =
    initialMissingHint ??
    (singleSeries && !points.some((point) => point.initial != null) ? INITIAL_MISSING_HINT : '');
  const shownSeries = {
    ...visibleSeries,
    ...(previousOff ? { previous: false } : {}),
    ...(initialOffHint ? { initial: false } : {}),
  };
  const visibleKeys = allSeries.filter((series) => shownSeries[series.key]).map((series) => series.key);
  const hasVisibleLine = visibleKeys.length > 0;
  const hasData = points.some((point) =>
    visibleKeys.some((key) => point[key] != null)
  );
  // First load only (a refetch keeps the old chart under the overlay); a fast
  // load skips the placeholder instead of flashing it.
  const firstLoad = useDelayedLoading({ loading: loading && !hasData });
  const chartPoints = useMemo(
    () => padMonthlyPoints(points, startDate, endDate),
    [points, startDate, endDate]
  );
  // The Actual line breaks at months with no actual; each gap gets its own
  // dashed join (one key per gap).
  const actualBridges = withActualBridges(chartPoints);
  const chartData = actualBridges.points.map((point, index) => ({ ...point, x: index }));
  const lastIndex = Math.max(chartData.length - 1, 0);
  const trailingMonth = chartData.length ? nextMonthYear(chartData.at(-1).month_year) : '';
  const monthYears = chartPoints.map((point) => point.month_year);
  const overlayBands = buildPromoOverlayBands(
    promotions,
    selectedPromoTypes,
    selectedPackTypes,
    monthYears
  );
  const dividerXs = promoPeriodDividerXs(
    promotions,
    selectedPromoTypes,
    selectedPackTypes,
    monthYears
  );
  const plotData = chartData.length
    ? [
        ...chartData,
        {
          x: lastIndex + 1,
          label: formatMonthLabel(trailingMonth),
          month_year: trailingMonth,
          axisOnly: true,
        },
      ]
    : chartData;
  const ticks = plotData.map((point) => point.x);
  // Keep every tick in the DOM: the chart's month hover lookup uses their positions.
  const formatMobileYear = yearAxisProps(chartData, 'month_year').tickFormatter;
  // Every line drawn, including the Scenario builder's, needs a timing.
  const lineTimings = lineSweepTimings(plotData, allSeries.map((series) => series.key), LINE_SWEEP);

  // No 80% range is drawn: the tooltip's CONFIDENCE section gives it in
  // figures, so the axis only has to fit the lines.
  const visibleValues = chartData
    .flatMap((point) => visibleKeys.map((key) => point[key]))
    .filter((value) => typeof value === 'number');
  // Hover text for the line pills, so the explanations don't crowd the chart.
  const lineHints = forecastLineHints({
    initialMissing: initialOffHint,
    previousMissing: previousOff,
  });
  const yDomain = visibleValues.length ? niceYDomain(visibleValues) : [0, 1];
  const hoverPoint = chartPoints.find((point) => point.month_year === hoverMonth);
  const hoverPromos = promosOverlappingMonth(
    promotions,
    hoverMonth,
    selectedPromoTypes,
    selectedPackTypes
  );
  const panelLeft = promoPanelLeft(panelX, wrapWidth);
  const seriesValues = allSeries.filter((series) => shownSeries[series.key]).map((series) => ({
    key: series.key,
    label: series.label,
    color: series.color,
    value: hoverPoint?.[series.key],
  }));
  const formatValue = (value) => formatTooltipValue(value, 'units');
  const monthX = (monthYear) => monthYears.indexOf(monthYear);
  // The Scenario builder sends no Simulated series until a switched-on block
  // changes something in view, so its gap, markers and band wait for it too.
  const simulatedSeries = scenario?.series[0] ?? null;
  const showSimulated = Boolean(simulatedSeries) && Boolean(visibleSeries.simulated);
  // A filter change moves the lines, the simulated gap and the axis together.
  // Same ticks as ever: the domain in 4 equal steps (none when it is flat).
  const transition = useChartTransition({
    rows: plotData,
    rowKey: 'month_year',
    valueKeys: showSimulated ? [...visibleKeys, 'simulatedGap'] : visibleKeys,
    domain: yDomain,
    ticks: yDomain[0] === yDomain[1]
      ? undefined
      : [0, 1, 2, 3, 4].map((i) => yDomain[0] + ((yDomain[1] - yDomain[0]) / 4) * i),
  });
  const scenarioMarkers = showSimulated
    ? scenario.markers
        .map((marker) => ({ ...marker, x: monthX(marker.month_year) }))
        .filter((marker) => marker.x >= 0 && chartData[marker.x]?.simulated != null)
    : [];
  // The block selected in the panel or the blocks table: its months banded.
  const selectedBand =
    showSimulated && scenario.selectedBand
      ? {
          ...scenario.selectedBand,
          // Centred on the month's points (plotted at whole x values), so
          // the band sits behind the months it changes.
          x1: monthX(scenario.selectedBand.startMonth) - 0.5,
          x2: monthX(scenario.selectedBand.endMonth) + 0.5,
        }
      : null;
  const scenarioBands = (scenario?.promoBands ?? [])
    .map((band) => ({ ...band, x1: monthX(band.startMonth), x2: monthX(band.endMonth) + 1 }))
    .filter((band) => band.x1 >= 0 && band.x2 > 0);

  function axisXFromClientX(clientX) {
    if (!chartWrapRef.current || !chartPoints.length) return null;
    const ticks = [...chartWrapRef.current.querySelectorAll('.recharts-xAxis .recharts-cartesian-axis-tick')];
    const mids = ticks.map((tick) => {
      const box = tick.getBoundingClientRect();
      return box.x + box.width / 2;
    });
    if (mids.length < 2) {
      const wrap = chartWrapRef.current.getBoundingClientRect();
      const yAxisWidth = Y_AXIS_WIDTH;
      const ratio = (clientX - wrap.left - yAxisWidth) / Math.max(wrap.width - yAxisWidth - 18, 1);
      return Math.max(0, Math.min(lastIndex + 1, ratio * (lastIndex + 1)));
    }
    if (clientX <= mids[0]) return 0;
    if (clientX >= mids[mids.length - 1]) return lastIndex + 1;
    for (let i = 0; i < mids.length - 1; i += 1) {
      if (clientX <= mids[i + 1]) {
        const span = mids[i + 1] - mids[i] || 1;
        return i + (clientX - mids[i]) / span;
      }
    }
    return lastIndex + 1;
  }

  function monthFromPointer(clientX) {
    const axisX = axisXFromClientX(clientX);
    if (axisX == null) return null;
    const covering = overlayBands.filter((band) => axisX >= band.x1 && axisX <= band.x2);
    if (covering.length) {
      const capped = Math.min(axisX, ...covering.map((band) => band.x2 - 1e-6));
      const index = Math.max(0, Math.min(lastIndex, Math.floor(capped)));
      return chartPoints[index]?.month_year ?? null;
    }
    if (axisX >= lastIndex + 1) return null;
    const index = Math.max(0, Math.min(lastIndex, Math.floor(axisX)));
    return chartPoints[index]?.month_year ?? null;
  }

  function rememberPointerX(event) {
    if (!chartWrapRef.current) return;
    const width = chartWrapRef.current.clientWidth;
    if (width && width !== wrapWidth) setWrapWidth(width);
    if (event.target.closest('[data-promo-panel]')) {
      overPanelRef.current = true;
      return;
    }
    overPanelRef.current = false;
    lastPointerXRef.current = event.clientX - chartWrapRef.current.getBoundingClientRect().left;
    setHoverFromChart(monthFromPointer(event.clientX));
  }

  function setHoverFromChart(monthYear) {
    if (!monthYear || overPanelRef.current) return;
    if (hoverMonthRef.current === monthYear) return;
    hoverMonthRef.current = monthYear;
    setPanelX(lastPointerXRef.current);
    setOpenPromoId(null);
    setHoverMonth(monthYear);
  }

  function clearHover() {
    overPanelRef.current = false;
    hoverMonthRef.current = null;
    setHoverMonth(null);
    setOpenPromoId(null);
  }

  return (
    // relative z-10: each glass card's backdrop-filter makes it its own
    // stacking context, so the tooltip and promotion panel can't out-rank the
    // cards below from inside; lifting the whole card lets them overlap the
    // year-totals card instead of going under it.
    <ChartCard
      title="Monthly forecast"
      detail={scopeTags.length ? (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {scopeTags.map((tag) => (
            <ScopeTag key={tag.label} label={tag.label} value={tag.value} />
          ))}
        </div>
      ) : null}
      className="relative z-10 max-w-full"
    >
      <div className="min-w-0 space-y-3">
        {toolbar}
        <div className={cn(glassInsetClass, 'flex flex-wrap items-center justify-between gap-3 px-3 py-2')}>
          <LineToggle
            series={allSeries}
            visible={shownSeries}
            onToggle={onToggleSeries}
            hints={lineHints}
            disabled={{ previous: previousOff, initial: Boolean(initialOffHint) }}
          />
          <ForecastPromoToggle
            selectedTypes={selectedPromoTypes}
            onToggleType={onTogglePromoType}
            selectedPacks={selectedPackTypes}
            onTogglePack={onTogglePackType}
          />
        </div>

        {!hasVisibleLine ? (
          <p className="text-sm text-muted-foreground">No lines selected. Turn a line on to plot values.</p>
        ) : firstLoad.pending || !hasData ? (
          // Rows start empty, so without this the first load would briefly
          // claim there is no data. Same box as the loaded chart below (its
          // ChartFrame, 34vh / min 220px ChartContainer with the 48px tilted
          // month axis, then the legend footer line), one line per series
          // switched on and one point per month in the date range.
          // A refetch keeps the old chart under the overlay instead.
          firstLoad.pending ? (
            <div className={firstLoad.placeholderClass}>
              <div className={CHART_FRAME_CLASS}>
                <LineChartSkeleton
                  points={chartPoints.length}
                  lines={visibleKeys.length}
                  height={220}
                  fill
                  tiltXTicks
                  label="Loading forecast…"
                  className="h-[34vh]"
                />
              </div>
              <div className="mt-1 flex justify-center px-3 pb-1">
                <Skeleton className="h-3 w-72 max-w-full rounded bg-lavander motion-reduce:animate-none" />
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{emptyMessage}</p>
          )
        ) : (
          <>
            <div className="overflow-visible">
              {/* The frame draws the panel; chartWrapRef inside it is what the
                  pointer, tick and promotion-panel positions are measured from. */}
              <ChartFrame>
                <div
                  ref={chartWrapRef}
                  className="relative z-20 overflow-visible"
                  onMouseMoveCapture={rememberPointerX}
                  onMouseLeave={(event) => {
                    const next = event.relatedTarget;
                    if (next instanceof Node && chartWrapRef.current?.contains(next)) return;
                    clearHover();
                  }}
                >
                <ChartContainer config={config} className="aspect-auto h-[34vh] min-h-[220px] w-full">
                  <ComposedChart
                    accessibilityLayer
                    data={transition.rows}
                    margin={{ top: 8, right: 18, left: 0, bottom: 28 }}
                  >
                    <OverlayDefs bands={overlayBands} />
                    <XAxis
                      dataKey="x"
                      type="number"
                      domain={[0, lastIndex + 1]}
                      ticks={ticks}
                      interval={0}
                      height={mobile ? 28 : 48}
                      tick={AXIS_TICK}
                      tickFormatter={(index) => mobile
                        ? formatMobileYear(plotData[index]?.month_year)
                        : (plotData[index]?.label ?? '')}
                      angle={mobile ? 0 : -40}
                      textAnchor={mobile ? 'middle' : 'end'}
                      tickMargin={8}
                    />
                    <YAxis
                      width={Y_AXIS_WIDTH}
                      domain={transition.domain}
                      ticks={transition.ticks}
                      allowDataOverflow
                      tick={AXIS_TICK}
                      tickFormatter={(value) => formatAxisValue(value, 'units')}
                    />
                    <ChartTooltip
                      wrapperStyle={{ zIndex: 30, pointerEvents: 'none' }}
                      content={(props) => {
                        const point = props.payload?.[0]?.payload;
                        if (hoverPromos.length) return null;
                        if (!props.active || !point?.label || point.axisOnly) return null;
                        return (
                          <ChartTooltipContent
                            {...props}
                            className={CHART_TOOLTIP_CLASS}
                            labelFormatter={(_value, payload) => payload?.[0]?.payload?.label ?? ''}
                            valueFormatter={formatValue}
                            footer={
                              <>
                                {showSimulated ? (
                                  <ScenarioPointDetails
                                    point={point}
                                    items={scenario.monthItems?.get(point.month_year) ?? []}
                                    formatValue={formatValue}
                                    className="mt-1 border-t border-lavander pt-1.5"
                                  />
                                ) : null}
                                <ForecastConfidenceDetails
                                  entries={point.confidence}
                                  formatValue={formatValue}
                                  dotSymbols={confidenceDots}
                                  showPrevious={Boolean(shownSeries.previous)}
                                  className="mt-1 border-t border-lavander pt-1.5"
                                />
                                <ForecastPointDetails
                                  details={forecastPointDetails(point, { showPrevious: shownSeries.previous })}
                                  className="mt-1 border-t border-lavander pt-1.5"
                                />
                              </>
                            }
                          />
                        );
                      }}
                    />
                    <PromoBands bands={overlayBands} span={lastIndex + 1} />
                    {dividerXs.map((x) => (
                      <ReferenceLine
                        key={`promo-divider-${x}`}
                        x={x}
                        stroke="#3A4369"
                        strokeOpacity={0.16}
                        strokeWidth={1}
                        ifOverflow="visible"
                      />
                    ))}
                    {selectedBand && selectedBand.x1 >= -0.5 && selectedBand.x2 > 0 ? (
                      <ReferenceArea
                        x1={Math.max(selectedBand.x1, 0)}
                        x2={selectedBand.x2}
                        fill="var(--color-scenario-soft)"
                        fillOpacity={0.9}
                        stroke="none"
                        ifOverflow="visible"
                        label={{
                          value: selectedBand.label,
                          position: 'insideTop',
                          fontSize: 10,
                          fontWeight: 600,
                          fill: 'var(--color-scenario-ink)',
                        }}
                      />
                    ) : null}
                    {scenarioBands.map((band) => (
                      <ReferenceArea
                        key={band.key}
                        x1={band.x1}
                        x2={band.x2}
                        fill="none"
                        stroke={band.color}
                        strokeDasharray="4 3"
                        strokeWidth={1.5}
                        ifOverflow="visible"
                      />
                    ))}
                    {scenario?.seasonalAverage != null && visibleSeries.simulated ? (
                      <ReferenceLine
                        y={scenario.seasonalAverage}
                        stroke="#A8741A"
                        strokeDasharray="4 4"
                        strokeWidth={1.4}
                        ifOverflow="extendDomain"
                        label={{
                          value: `Seasonal avg ${formatAxisValue(Math.round(scenario.seasonalAverage), 'units')}`,
                          position: 'insideTopRight',
                          fontSize: 10,
                          fill: '#A8741A',
                        }}
                      />
                    ) : null}
                    {showSimulated ? (
                      <Area
                        dataKey="simulatedGap"
                        type="monotone"
                        stroke="none"
                        fill={simulatedSeries.color}
                        fillOpacity={0.3}
                        tooltipType="none"
                        legendType="none"
                        activeDot={false}
                        isAnimationActive={false}
                      />
                    ) : null}
                    {allSeries.filter((series) => shownSeries[series.key]).map((series) => (
                      <Line
                        key={series.key}
                        dataKey={series.key}
                        name={series.label}
                        type="monotone"
                        stroke={series.color}
                        strokeWidth={series.strokeWidth ?? 2.4}
                        strokeOpacity={series.strokeOpacity ?? 1}
                        strokeDasharray={series.dash}
                        dot={(props) => (
                          <SeriesDot
                            cx={props.cx}
                            cy={props.cy}
                            color={series.color}
                            shape={series.shape}
                            fill={dotFill(series.key, props.payload, confidenceDots)}
                            delay={dotRevealDelay(lineTimings[series.key], props.points, props.cx)}
                          />
                        )}
                        activeDot={{ r: 5, fill: series.color }}
                        connectNulls={series.connectNulls ?? true}
                        {...lineTimings[series.key]}
                        {...transition.seriesAnimation}
                      />
                    ))}
                    {/* Dashed joins across months with no actual (a missing file),
                        under the Actual line; never a point, never in the tooltip. */}
                    {shownSeries.actual
                      ? actualBridges.keys.map((key) => (
                          <Line
                            key={key}
                            dataKey={key}
                            type="linear"
                            stroke={ACTUAL_COLOR}
                            strokeWidth={1.6}
                            strokeOpacity={0.7}
                            strokeDasharray="4 4"
                            dot={false}
                            activeDot={false}
                            connectNulls
                            tooltipType="none"
                            legendType="none"
                            isAnimationActive={false}
                          />
                        ))
                      : null}
                    {scenarioMarkers.map((marker) => (
                      <ReferenceDot
                        key={`marker-${marker.key}`}
                        x={marker.x}
                        /* From the moving rows, so a marker rides its line through a change. */
                        y={transition.rows[marker.x].simulated}
                        r={6}
                        fill={simulatedSeries.color}
                        stroke="#fff"
                        strokeWidth={2}
                        ifOverflow="visible"
                      />
                    ))}
                  </ComposedChart>
                </ChartContainer>
                {loading && <ChartLoading overlay label="Updating forecast…" />}
                {/* Hidden while loading so it can't open over the overlay with old values. */}
                {!loading && hoverPromos.length ? (
                  <div
                    data-promo-panel="true"
                    className="absolute z-50"
                    style={{ top: 86, left: panelLeft }}
                    onMouseEnter={() => {
                      overPanelRef.current = true;
                    }}
                    onMouseLeave={() => {
                      overPanelRef.current = false;
                    }}
                  >
                    <ForecastPromoPanel
                      monthLabel={hoverPoint?.label ?? formatMonthLabel(hoverMonth)}
                      seriesValues={seriesValues}
                      details={forecastPointDetails(hoverPoint, { showPrevious: shownSeries.previous })}
                      formatValue={formatValue}
                      confidenceDetails={
                        <ForecastConfidenceDetails
                          entries={hoverPoint?.confidence}
                          formatValue={formatValue}
                          dotSymbols={confidenceDots}
                          showPrevious={Boolean(shownSeries.previous)}
                          interactive
                        />
                      }
                      scenarioDetails={
                        showSimulated ? (
                          <ScenarioPointDetails
                            point={hoverPoint}
                            items={scenario.monthItems?.get(hoverMonth) ?? []}
                            formatValue={formatValue}
                            hasEntered={scenario.stacksOnEntered}
                          />
                        ) : null
                      }
                      promos={hoverPromos}
                      openPromoId={openPromoId}
                      onTogglePromo={(key) =>
                        setOpenPromoId((current) => (current === key ? null : key))
                      }
                    />
                  </div>
                ) : null}
                </div>
              </ChartFrame>
              <ForecastLegendFooter
                lastRun={lastRun}
                salesLabel={salesLabel}
                salesLoadedAt={salesLoadedAt}
                pastAccuracy={pastAccuracy}
                updatingBadge={updatingBadge}
                notes={[...initialNotes, ...notes]}
                className="mt-3 px-3 pb-1"
              />
            </div>
            {summary}
            {yearTable}
          </>
        )}
      </div>
    </ChartCard>
  );
}
