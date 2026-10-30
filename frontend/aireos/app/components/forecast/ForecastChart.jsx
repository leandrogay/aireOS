'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Area, ComposedChart, Line, ReferenceArea, ReferenceDot, ReferenceLine, XAxis, YAxis } from 'recharts';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import ChartLoading from '@/components/ui/ChartLoading';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ForecastLineToggle from '@/components/forecast/ForecastLineToggle';
import ForecastPointDetails from '@/components/forecast/ForecastPointDetails';
import ForecastPromoPanel from '@/components/forecast/ForecastPromoPanel';
import ForecastPromoToggle from '@/components/forecast/ForecastPromoToggle';
import ForecastTable from '@/components/forecast/ForecastTable';
import ForecastYearTotals from '@/components/forecast/ForecastYearTotals';
import ForecastLegendFooter from '@/components/forecast/ForecastLegendFooter';
import {
  FORECAST_SERIES,
  buildPromoOverlayBands,
  forecastPointDetails,
  formatMonthLabel,
  nextMonthYear,
  padMonthlyPoints,
  promoPeriodDividerXs,
  promosOverlappingMonth,
} from '@/app/utils/forecastView';
import { dotRevealDelay, lineSweepTimings } from '@/app/utils/lineAnimation';

// All lines draw in with one left-to-right sweep (see lineSweepTimings), so
// Actual, Initial and Current reach each month together. The promo bands wipe
// in with the same sweep (PromoBands).
const LINE_SWEEP = { begin: 0, duration: 1200 };
const SERIES_KEYS = FORECAST_SERIES.map((series) => series.key);

// How long a promo band takes to wipe in when it is added after the first draw.
const LATE_BAND_MS = 300;

const chartConfig = Object.fromEntries(
  FORECAST_SERIES.map((series) => [series.key, { label: series.label, color: series.color }])
);

function formatAxisValue(value, metric) {
  if (typeof value !== 'number') return value;
  if (metric === 'revenue') {
    if (Math.abs(value) >= 1000) {
      return `$${(value / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })}k`;
    }
    return `$${value}`;
  }
  if (Math.abs(value) >= 1000) {
    return `${(value / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })}k`;
  }
  return `${value}`;
}

function niceYDomain(values) {
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  const span = dataMax - dataMin;
  const padding = span * 0.1 || Math.abs(dataMax) * 0.1 || 1;
  let low = dataMin - padding;
  let high = dataMax + padding;
  if (low < 0 && dataMin >= 0) low = 0;
  const rawStep = (high - low) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep || 1));
  const residual = rawStep / magnitude;
  const step = residual >= 5 ? 10 * magnitude : residual >= 2 ? 5 * magnitude : 2 * magnitude;
  return [Math.floor(low / step) * step, Math.ceil(high / step) * step];
}

function formatTooltipValue(value, metric) {
  if (typeof value !== 'number') return value;
  if (metric === 'revenue') {
    return `$${value.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
  return Math.round(value).toLocaleString('en-US');
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

// `delay` (ms) fades the dot in as its line is drawn past it (.line-dot-in).
function SeriesDot({ cx, cy, color, shape, delay }) {
  if (cx == null || cy == null) return null;
  const reveal = { className: 'line-dot-in', style: { animationDelay: `${delay}ms` } };
  if (shape === 'square') {
    return (
      <rect x={cx - 3.5} y={cy - 3.5} width={7} height={7} fill={color} stroke="#fff" strokeWidth={1} {...reveal} />
    );
  }
  if (shape === 'diamond') {
    return (
      <polygon
        points={`${cx},${cy - 5} ${cx + 5},${cy} ${cx},${cy + 5} ${cx - 5},${cy}`}
        fill={color}
        stroke="#fff"
        strokeWidth={1}
        {...reveal}
      />
    );
  }
  if (shape === 'triangle') {
    return (
      <polygon
        points={`${cx},${cy - 5} ${cx + 5},${cy + 4} ${cx - 5},${cy + 4}`}
        fill={color}
        stroke="#fff"
        strokeWidth={1}
        {...reveal}
      />
    );
  }
  return <circle cx={cx} cy={cy} r={3.5} fill={color} stroke="#fff" strokeWidth={1} {...reveal} />;
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

// Tooltip footer in the Scenario builder: how far Simulated sits from
// Current this month, and which switched-on blocks add to it.
function ScenarioPointDetails({ point, items, metric, formatValue }) {
  if (point.simulated == null || point.current == null) return null;
  const delta = point.simulated - point.current;
  if (!delta) return null;
  const pct = point.current ? ` (${delta < 0 ? '−' : '+'}${Math.abs((delta / point.current) * 100).toFixed(1)}%)` : '';
  // Sign written here, figure unsigned, so revenue reads "+$2,555.00".
  const signed = (value) => `${value < 0 ? '−' : '+'}${formatValue(Math.abs(value))}`;
  return (
    <div className="mt-1 space-y-0.5 border-t border-lavander pt-1.5 text-[11px] tabular-nums">
      <div className="flex justify-between gap-3">
        <span>Difference</span>
        <span className="font-semibold text-scenario-ink">
          {signed(delta)}
          {pct}
        </span>
      </div>
      {items.length ? (
        <>
          <p className="pt-1 text-[10px] font-semibold uppercase tracking-wide text-deep-violet-blue/50">
            What adds to this month
          </p>
          {items.map((item) => {
            const value = metric === 'revenue' ? item.deltaRevenue : item.deltaUnits;
            return (
              <div key={item.itemId} className="flex justify-between gap-3">
                <span className="truncate">{item.name}</span>
                <span className="font-semibold text-scenario-ink">
                  {signed(value)}
                </span>
              </div>
            );
          })}
        </>
      ) : null}
    </div>
  );
}

export default function ForecastChart({
  points,
  startDate,
  endDate,
  metric,
  onMetricChange,
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
  confidence,
  yearTotals = [],
  yearTotalsLoading = false,
  horizonVolume = null,
  horizonRevenue = null,
  loading = false,
  scenario = null,
  // Scenario builder only (all default off, so /forecast is unchanged):
  // `toolbar` renders under the card header, `summary` right under the
  // chart; `yearTable` replaces ForecastYearTotals.
  toolbar = null,
  summary = null,
  yearTable = null,
}) {
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
  const visibleKeys = allSeries.filter((series) => visibleSeries[series.key]).map((series) => series.key);
  const hasVisibleLine = visibleKeys.length > 0;
  const hasData = points.some((point) =>
    visibleKeys.some((key) => point[key] != null)
  );
  const chartPoints = useMemo(
    () => padMonthlyPoints(points, startDate, endDate),
    [points, startDate, endDate]
  );
  const chartData = chartPoints.map((point, index) => ({ ...point, x: index }));
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
  const lineTimings = lineSweepTimings(plotData, SERIES_KEYS, LINE_SWEEP);

  const showRange = Boolean(visibleSeries.current) && chartData.some((point) => point.range);
  const visibleValues = chartData.flatMap((point) => [
    ...visibleKeys.map((key) => point[key]),
    ...(showRange && point.range ? point.range : []),
  ]).filter((value) => typeof value === 'number');
  // Hover text for the line pills, so the explanations don't crowd the chart.
  // One SKU with no Initial values in range gets its own reason; today the
  // only cause is the 6-month history minimum (Ultra Tape in the 2026
  // backfill). The Ultra Tape sentence is data-specific: the backfill skipped
  // it, so an All SKUs Initial total leaves it out while Current includes it.
  // Drop that sentence once 2026 is out of view.
  const initialMissingForSku = singleSeries && !points.some((point) => point.initial != null);
  const lineHints = {
    initial: initialMissingForSku
      ? "No Initial Yearly Forecast for this SKU in this period: it had under 6 months of sales history when the year's plan was frozen."
      : 'Initial Yearly Forecast: the plan for the year, frozen each December from data up to that point. ' +
        '2026 was backfilled using data up to Dec 2025.' +
        (singleSeries
          ? ''
          : ' Ultra Tape has no 2026 Initial (under 6 months of history), so the All SKUs Initial total excludes it.'),
    current: singleSeries
      ? null
      : 'Pick one SKU and customer to see the 80% range and the forecast confidence.',
  };
  const yDomain = visibleValues.length ? niceYDomain(visibleValues) : [0, 1];
  const hoverPoint = chartPoints.find((point) => point.month_year === hoverMonth);
  const hoverPromos = promosOverlappingMonth(
    promotions,
    hoverMonth,
    selectedPromoTypes,
    selectedPackTypes
  );
  const panelLeft = promoPanelLeft(panelX, wrapWidth);
  const seriesValues = allSeries.filter((series) => visibleSeries[series.key]).map((series) => ({
    key: series.key,
    label: series.label,
    color: series.color,
    value: hoverPoint?.[series.key],
  }));
  const formatValue = (value) => formatTooltipValue(value, metric);
  const monthX = (monthYear) => monthYears.indexOf(monthYear);
  // The Scenario builder sends no Simulated series until a switched-on block
  // changes something in view, so its gap, markers and band wait for it too.
  const simulatedSeries = scenario?.series[0] ?? null;
  const showSimulated = Boolean(simulatedSeries) && Boolean(visibleSeries.simulated);
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
      const yAxisWidth = metric === 'revenue' ? 52 : 40;
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
    <Card size="sm" className="overflow-visible rounded-lg border border-lavander bg-white text-deep-violet-blue shadow-sm ring-0">
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-1">
        <div className="min-w-0 space-y-1.5">
          <CardTitle className="font-serif text-base font-normal text-deep-violet-blue group-data-[size=sm]/card:text-base">
            Monthly forecast
          </CardTitle>
          {scopeTags.length ? (
            <div className="flex flex-wrap gap-1.5">
              {scopeTags.map((tag) => (
                <ScopeTag key={tag.label} label={tag.label} value={tag.value} />
              ))}
            </div>
          ) : null}
        </div>
        <Tabs value={metric} onValueChange={onMetricChange}>
          <TabsList className="h-7 bg-lavander p-0.5">
            <TabsTrigger
              value="units"
              className="h-6 px-2.5 text-[11px] text-deep-violet-blue/70 hover:bg-white hover:text-deep-violet-blue data-active:bg-deep-violet-blue data-active:text-white data-active:hover:bg-deep-violet-blue data-active:hover:text-white"
            >
              Volume
            </TabsTrigger>
            <TabsTrigger
              value="revenue"
              className="h-6 px-2.5 text-[11px] text-deep-violet-blue/70 hover:bg-white hover:text-deep-violet-blue data-active:bg-deep-violet-blue data-active:text-white data-active:hover:bg-deep-violet-blue data-active:hover:text-white"
            >
              Revenue
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent className="space-y-3">
        {toolbar}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-lavander bg-white px-3 py-2">
          <ForecastLineToggle series={allSeries} visible={visibleSeries} onToggle={onToggleSeries} hints={lineHints} />
          <ForecastPromoToggle
            selectedTypes={selectedPromoTypes}
            onToggleType={onTogglePromoType}
            selectedPacks={selectedPackTypes}
            onTogglePack={onTogglePackType}
          />
        </div>

        {!hasVisibleLine ? (
          <p className="text-sm text-muted-foreground">No lines selected. Turn a line on to plot values.</p>
        ) : !hasData ? (
          // Rows start empty, so without this the first load would briefly
          // claim there is no data. Sized like the chart frame below.
          loading ? (
            <ChartLoading
              label="Loading forecast…"
              className="h-[calc(34vh+10px)] min-h-[230px] rounded-xl border border-lavander bg-white"
            />
          ) : (
            <p className="text-sm text-muted-foreground">No forecast data matches these filters.</p>
          )
        ) : (
          <>
            <div className="overflow-visible">
              <div
                ref={chartWrapRef}
                className="relative z-20 overflow-visible pl-1 pr-3 pt-2"
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
                  data={plotData}
                  margin={{ top: 8, right: 18, left: 0, bottom: 28 }}
                >
                  <OverlayDefs bands={overlayBands} />
                  <XAxis
                    dataKey="x"
                    type="number"
                    domain={[0, lastIndex + 1]}
                    ticks={ticks}
                    interval={0}
                    height={48}
                    tick={{ fontSize: 9, fill: '#3A4369' }}
                    tickFormatter={(index) => plotData[index]?.label ?? ''}
                    angle={-40}
                    textAnchor="end"
                    tickMargin={8}
                  />
                  <YAxis
                    width={metric === 'revenue' ? 52 : 40}
                    domain={yDomain}
                    ticks={
                      yDomain[0] === yDomain[1]
                        ? undefined
                        : [0, 1, 2, 3, 4].map((i) => yDomain[0] + ((yDomain[1] - yDomain[0]) / 4) * i)
                    }
                    allowDataOverflow
                    tick={{ fontSize: 10, fill: '#3A4369' }}
                    tickFormatter={(value) => formatAxisValue(value, metric)}
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
                          className="border-violet/40 bg-white"
                          labelFormatter={(_value, payload) => payload?.[0]?.payload?.label ?? ''}
                          valueFormatter={formatValue}
                          footer={
                            <>
                              {showSimulated ? (
                                <ScenarioPointDetails
                                  point={point}
                                  items={scenario.monthItems?.get(point.month_year) ?? []}
                                  metric={metric}
                                  formatValue={formatValue}
                                />
                              ) : null}
                              <ForecastPointDetails
                                details={forecastPointDetails(point, metric, formatValue)}
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
                  {/* Archived for now: 80% confidence band around the current forecast line.
                      Restore by uncommenting this block.
                  {showRange ? (
                    <Area
                      dataKey="range"
                      name="80% range"
                      type="monotone"
                      stroke="none"
                      fill={chartConfig.current.color}
                      fillOpacity={0.14}
                      tooltipType="none"
                      legendType="none"
                      activeDot={false}
                      isAnimationActive={false}
                    />
                  ) : null}
                  */}
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
                        value: `Seasonal avg ${formatAxisValue(Math.round(scenario.seasonalAverage), metric)}`,
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
                  {allSeries.filter((series) => visibleSeries[series.key]).map((series) => (
                    <Line
                      key={series.key}
                      dataKey={series.key}
                      name={series.label}
                      type="monotone"
                      stroke={series.color}
                      strokeWidth={2.4}
                      strokeDasharray={series.dash}
                      dot={(props) => (
                        <SeriesDot
                          cx={props.cx}
                          cy={props.cy}
                          color={series.color}
                          shape={series.shape}
                          delay={dotRevealDelay(lineTimings[series.key], props.points, props.cx)}
                        />
                      )}
                      activeDot={{ r: 5, fill: series.color }}
                      connectNulls={series.connectNulls ?? true}
                      {...lineTimings[series.key]}
                    />
                  ))}
                  {scenarioMarkers.map((marker) => (
                    <ReferenceDot
                      key={`marker-${marker.key}`}
                      x={marker.x}
                      y={chartData[marker.x].simulated}
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
                    details={forecastPointDetails(hoverPoint, metric, formatValue)}
                    formatValue={formatValue}
                    promos={hoverPromos}
                    openPromoId={openPromoId}
                    onTogglePromo={(key) =>
                      setOpenPromoId((current) => (current === key ? null : key))
                    }
                  />
                </div>
              ) : null}
              </div>
              <ForecastLegendFooter
                lastRun={lastRun}
                salesLabel={salesLabel}
                salesLoadedAt={salesLoadedAt}
                confidence={confidence}
                className="-mt-6 px-3 pb-1 pt-0"
              />
            </div>
            {summary}
            {/* `loading` too: while the page refetches, `points` still hold
                the previous filter's months, and a year total from those
                would be wrong rather than merely stale. */}
            {yearTable ?? (
              <ForecastYearTotals
                years={yearTotals}
                loading={yearTotalsLoading || loading}
                horizonVolume={horizonVolume}
                horizonRevenue={horizonRevenue}
                simulatedYears={showSimulated ? scenario.simulatedYears : []}
              />
            )}

            {/* The Scenario builder reviews changes in its comparison and
                blocks tables instead, so the monthly table is /forecast only. */}
            {scenario ? null : (
              <ForecastTable
                points={points}
                metric={metric}
                visibleSeries={visibleSeries}
              />
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
