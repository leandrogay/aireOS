'use client';

import { useMemo } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, XAxis, YAxis } from 'recharts';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ForecastLineToggle from '@/components/forecast/ForecastLineToggle';
import ForecastPromoToggle from '@/components/forecast/ForecastPromoToggle';
import ForecastTable from '@/components/forecast/ForecastTable';
import { promoTypeLabel } from '@/app/utils/promotionForm';
import {
  FORECAST_SERIES,
  monthHasPromoType,
  overlayBandsForPromo,
  overlayMonthDividers,
  formatMonthLabel,
  nextMonthYear,
  padMonthlyPoints,
  promoOverlayStyle,
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

function PromoTooltipDetails({ point, overlayType }) {
  if (!overlayType || !point || !monthHasPromoType(point, overlayType)) return null;
  const details = point.promoByType?.[overlayType] ?? {};
  const skuNames = details.productNames ?? [];
  const rows = [
    ['Type', promoTypeLabel(overlayType)],
    ['Mechanic', details.promotion_mechanic],
    ['Period', details.period_label],
    ['Voucher', details.voucher],
  ].filter(([, value]) => value);
  if (!rows.length && skuNames.length <= 1) return null;
  return (
    <div className="mt-1.5 grid max-w-[16rem] gap-0.5 border-t border-border/50 pt-1.5 text-[11px] text-muted-foreground">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-3">
          <span>{label}</span>
          <span className="font-medium text-foreground">{value}</span>
        </div>
      ))}
      {skuNames.length > 1 ? (
        <div className="mt-0.5">
          <p>SKUs</p>
          <ul className="mt-0.5 space-y-0.5 font-medium text-foreground">
            {skuNames.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
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

export default function ForecastChart({
  points,
  startDate,
  endDate,
  metric,
  onMetricChange,
  scopeTags,
  promoType,
  onPromoTypeChange,
  visibleSeries,
  onToggleSeries,
}) {
  const hasData = points.some((point) =>
    FORECAST_SERIES.some((series) => visibleSeries[series.key] && point[series.key] != null)
  );
  const chartPoints = useMemo(
    () => padMonthlyPoints(points, startDate, endDate),
    [points, startDate, endDate]
  );
  const chartData = chartPoints.map((point, index) => ({ ...point, x: index }));
  const lastIndex = Math.max(chartData.length - 1, 0);
  const trailingMonth = chartData.length ? nextMonthYear(chartData.at(-1).month_year) : '';
  const plotData = chartData.length
    ? [
        ...chartData,
        {
          x: lastIndex + 1,
          label: formatMonthLabel(trailingMonth),
          month_year: trailingMonth,
          promoTypes: [],
          promoByType: {},
          axisOnly: true,
        },
      ]
    : chartData;
  const overlayStyle = promoOverlayStyle(promoType);
  const overlayBands = overlayBandsForPromo(chartPoints, promoType);
  const overlayDividers = overlayMonthDividers(chartPoints, promoType);
  const ticks = plotData.map((point) => point.x);

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
              Units
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
          <ForecastLineToggle visible={visibleSeries} onToggle={onToggleSeries} />
          <ForecastPromoToggle value={promoType} onChange={onPromoTypeChange} />
        </div>

        {!hasData ? (
          <p className="text-sm text-muted-foreground">No forecast data matches these filters.</p>
        ) : (
          <>
            <div className="rounded-xl border border-lavander bg-white pl-1 pr-3 pt-2">
              <ChartContainer config={chartConfig} className="aspect-auto h-[34vh] min-h-[220px] w-full">
                <LineChart
                  accessibilityLayer
                  data={plotData}
                  margin={{ top: 8, right: 18, left: 0, bottom: 28 }}
                >
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
                    width={36}
                    tick={{ fontSize: 10, fill: '#3A4369' }}
                    tickFormatter={(value) => formatAxisValue(value, metric)}
                  />
                  <ChartTooltip
                    content={(props) => {
                      if (!props.payload?.[0]?.payload?.label || props.payload[0].payload.axisOnly) {
                        return null;
                      }
                      return (
                        <ChartTooltipContent
                          {...props}
                          labelFormatter={(_value, payload) => payload?.[0]?.payload?.label ?? ''}
                          valueFormatter={(value) => formatTooltipValue(value, metric)}
                          footer={(payload) => (
                            <PromoTooltipDetails
                              point={payload?.[0]?.payload}
                              overlayType={promoType}
                            />
                          )}
                        />
                      );
                    }}
                  />
                  {overlayStyle
                    ? overlayBands.map((band) => (
                        <ReferenceArea
                          key={`${band.x1}-${band.x2}`}
                          x1={band.x1}
                          x2={band.x2}
                          fill={overlayStyle.fill}
                          fillOpacity={overlayStyle.fillOpacity}
                          stroke="none"
                          ifOverflow="visible"
                        />
                      ))
                    : null}
                  {overlayStyle
                    ? overlayDividers.map((x) => (
                        <ReferenceLine
                          key={`overlay-month-${x}`}
                          x={x}
                          stroke={overlayStyle.stroke}
                          strokeOpacity={overlayStyle.strokeOpacity}
                          strokeWidth={0.8}
                          ifOverflow="visible"
                        />
                      ))
                    : null}
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
                      connectNulls
                      isAnimationActive={false}
                    />
                  ))}
                </LineChart>
              </ChartContainer>
            </div>

            <ForecastTable
              points={points}
              metric={metric}
              promoType={promoType}
              visibleSeries={visibleSeries}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}
