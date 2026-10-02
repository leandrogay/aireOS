'use client';

import { useMemo, useRef, useState } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, XAxis, YAxis } from 'recharts';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ForecastLineToggle from '@/components/forecast/ForecastLineToggle';
import ForecastPointDetails from '@/components/forecast/ForecastPointDetails';
import ForecastPromoPanel from '@/components/forecast/ForecastPromoPanel';
import ForecastPromoToggle from '@/components/forecast/ForecastPromoToggle';
import ForecastTable from '@/components/forecast/ForecastTable';
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

function SeriesDot({ cx, cy, color, shape }) {
  if (cx == null || cy == null) return null;
  if (shape === 'square') {
    return <rect x={cx - 3.5} y={cy - 3.5} width={7} height={7} fill={color} stroke="#fff" strokeWidth={1} />;
  }
  if (shape === 'diamond') {
    return (
      <polygon
        points={`${cx},${cy - 5} ${cx + 5},${cy} ${cx},${cy + 5} ${cx - 5},${cy}`}
        fill={color}
        stroke="#fff"
        strokeWidth={1}
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
      />
    );
  }
  return <circle cx={cx} cy={cy} r={3.5} fill={color} stroke="#fff" strokeWidth={1} />;
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
}) {
  const chartWrapRef = useRef(null);
  const overPanelRef = useRef(false);
  const lastPointerXRef = useRef(0);
  const hoverMonthRef = useRef(null);
  const [hoverMonth, setHoverMonth] = useState(null);
  const [openPromoId, setOpenPromoId] = useState(null);
  const [panelX, setPanelX] = useState(0);
  const [wrapWidth, setWrapWidth] = useState(0);

  const visibleKeys = FORECAST_SERIES.filter((series) => visibleSeries[series.key]).map((series) => series.key);
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
  const seriesValues = FORECAST_SERIES.filter((series) => visibleSeries[series.key]).map((series) => ({
    key: series.key,
    label: series.label,
    color: series.color,
    value: hoverPoint?.[series.key],
  }));
  const formatValue = (value) => formatTooltipValue(value, metric);

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
    <Card size="sm" className="overflow-visible border border-violet/40 bg-white text-deep-violet-blue ring-0">
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-1">
        <div className="min-w-0 space-y-1.5">
          <CardTitle className="font-serif text-base font-normal text-deep-violet-blue group-data-[size=sm]/card:text-base">
            Monthly forecast
          </CardTitle>
          <div className="flex flex-wrap gap-1.5">
            {scopeTags.map((tag) => (
              <ScopeTag key={tag.label} label={tag.label} value={tag.value} />
            ))}
          </div>
        </div>
        <Tabs value={metric} onValueChange={onMetricChange}>
          <TabsList className="h-7 bg-lavander p-0.5">
            <TabsTrigger
              value="units"
              className="h-6 px-2.5 text-[11px] text-deep-violet-blue/70 hover:text-deep-violet-blue data-active:bg-deep-violet-blue data-active:text-white"
            >
              Carton units
            </TabsTrigger>
            <TabsTrigger
              value="revenue"
              className="h-6 px-2.5 text-[11px] text-deep-violet-blue/70 hover:text-deep-violet-blue data-active:bg-deep-violet-blue data-active:text-white"
            >
              Revenue
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-lavander bg-white px-3 py-2">
          <ForecastLineToggle visible={visibleSeries} onToggle={onToggleSeries} hints={lineHints} />
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
          <p className="text-sm text-muted-foreground">No forecast data matches these filters.</p>
        ) : (
          <>
            <div
              ref={chartWrapRef}
              className="relative z-20 overflow-visible rounded-xl border border-lavander bg-white pl-1 pr-3 pt-2"
              onMouseMoveCapture={rememberPointerX}
              onMouseLeave={(event) => {
                const next = event.relatedTarget;
                if (next instanceof Node && chartWrapRef.current?.contains(next)) return;
                clearHover();
              }}
            >
              <ChartContainer config={chartConfig} className="aspect-auto h-[34vh] min-h-[220px] w-full">
                <ComposedChart
                  accessibilityLayer
                  data={plotData}
                  margin={{ top: 8, right: 18, left: 0, bottom: 28 }}
                >
                  <OverlayDefs bands={overlayBands} />
                  <CartesianGrid vertical={false} stroke="var(--aire-lavender)" />
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
                            <ForecastPointDetails
                              details={forecastPointDetails(point, metric, formatValue)}
                              className="mt-1 border-t border-lavander pt-1.5"
                            />
                          }
                        />
                      );
                    }}
                  />
                  {overlayBands.map((band) => (
                    <ReferenceArea
                      key={band.key}
                      x1={band.x1}
                      x2={band.x2}
                      fill={band.colors.length > 1 ? `url(#${band.key})` : band.colors[0]}
                      fillOpacity={band.fillOpacity}
                      stroke="none"
                      ifOverflow="visible"
                    />
                  ))}
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
                  {FORECAST_SERIES.filter((series) => visibleSeries[series.key]).map((series) => (
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
                        />
                      )}
                      activeDot={{ r: 5, fill: series.color }}
                      connectNulls={series.connectNulls ?? true}
                      isAnimationActive={false}
                    />
                  ))}
                </ComposedChart>
              </ChartContainer>
              {hoverPromos.length ? (
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
            />

            <ForecastTable
              points={points}
              metric={metric}
              visibleSeries={visibleSeries}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}
