'use client';

import { useState } from 'react';
import { CartesianGrid, ComposedChart, Dot, Line, XAxis, YAxis } from 'recharts';

import ForecastLineToggle from '@/components/forecast/ForecastLineToggle';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';

import { FORECAST_SERIES } from '@/app/utils/forecastView';
import { formatMonth, formatUnits } from '@/app/utils/inventoryForm';
import { dotRevealDelay, lineSweepTimings } from '@/app/utils/lineAnimation';

import { labelledTooltipRow } from './chartTooltip';

// The sell-out lines keep the Forecast page's colours (forecastView.FORECAST_SERIES),
// so the two pages read the same way. Every line has its own colour, and the
// line style says which forecast it comes from, the same for sell-in and
// sell-out: solid with dots = actual, short dashes = Current, long dashes =
// Previous, dots = Initial. Eight colours can't all be told apart by colour
// alone (checked with the dataviz palette validator), so the style carries it
// too, and the toggles let you show only the lines being compared. Each
// sell-in colour passes the validator against the sell-out line of the same
// style (red/navy, blue/teal, green/purple, brown/orange), the pairs most
// often read together.
const FORECAST_LINE = Object.fromEntries(FORECAST_SERIES.map((series) => [series.key, series]));

const DASH = {
  current: FORECAST_LINE.current.dash,
  previous: FORECAST_LINE.previous.dash,
  initial: FORECAST_LINE.initial.dash,
};

// `dot`: the line has a dot per month (the actual lines), so its sample does too.
// `shape: 'line'` makes ForecastLineToggle show that line sample on its pill.
const SERIES = [
  { key: 'sell_in_actual', group: 'Sell-in', label: 'Sell-in (actual)', color: '#e34948', dot: true },
  { key: 'sell_in_recommended', group: 'Sell-in', label: 'Sell-in Forecast (Current)', color: '#2a78d6', dash: DASH.current },
  { key: 'sell_in_previous', group: 'Sell-in', label: 'Sell-in Forecast (Previous)', color: '#008300', dash: DASH.previous },
  { key: 'sell_in_initial', group: 'Sell-in', label: 'Initial Yearly Sell-in Forecast', color: '#92400e', dash: DASH.initial },
  { key: 'sell_out_actual', group: 'Sell-out', label: 'Sell-out (actual)', color: FORECAST_LINE.actual.color, dot: true },
  { key: 'sell_out_current', group: 'Sell-out', label: 'Sell-out Forecast (Current)', color: FORECAST_LINE.current.color, dash: DASH.current },
  { key: 'sell_out_previous', group: 'Sell-out', label: 'Sell-out Forecast (Previous)', color: FORECAST_LINE.previous.color, dash: DASH.previous },
  { key: 'sell_out_initial', group: 'Sell-out', label: 'Initial Yearly Sell-out Forecast', color: FORECAST_LINE.initial.color, dash: DASH.initial },
];

const GROUPS = ['Sell-in', 'Sell-out'].map((group) => ({
  label: group,
  series: SERIES.filter((series) => series.group === group).map((series) => ({ ...series, shape: 'line' })),
}));

const CHART_CONFIG = Object.fromEntries(SERIES.map((series) => [series.key, { label: series.label, color: series.color }]));

const TOOLTIP_ORDER = SERIES.map((series) => series.key);

const ALL_VISIBLE = Object.fromEntries(SERIES.map((series) => [series.key, true]));

// Each line sweeps left to right: the actual parts first, then the forecasts
// carry on from where they ended.
const LINE_SWEEP = { begin: 0, duration: 1200 };

// The current sell-in and sell-out lines start from the last actual point, so
// each reads as one stroke from actual into plan (see rows below). There the
// value is the actual, not a forecast, so the tooltip leaves it out. The
// Previous and Initial lines have values of their own in the actual months
// (backend _past_recommendations), so they never join.
const JOIN_KEYS = ['sell_in_recommended', 'sell_out_current'];

// Recharts' dot, faded in as the line reaches it (dotRevealDelay). `points` is
// the whole line, which is not a valid attribute for one circle.
function timedDot(timing) {
  return function TimedDot({ points, ...dotProps }) {
    const delay = dotRevealDelay(timing, points, dotProps.cx);
    return <Dot {...dotProps} className="line-dot-in" style={{ animationDelay: `${delay}ms` }} />;
  };
}

/**
 * The plan months that run on the Initial Yearly Sell-out Forecast because the
 * current forecast does not reach them yet, as a label ("Aug 2026 – Sep 2026"), or null.
 *
 * @param {Array<{ month: string, forecast_source: string | null }>} months
 * @returns {string | null}
 */
export function initialFallbackLabel(months) {
  const fallback = months.filter((row) => row.forecast_source === 'initial' || row.forecast_source === 'mixed');
  if (fallback.length === 0) return null;
  const first = formatMonth(fallback[0].month);
  const last = formatMonth(fallback[fallback.length - 1].month);
  return first === last ? first : `${first} – ${last}`;
}

/**
 * Sell-in against sell-out by month for the sell-in plan, all as lines, each
 * of which can be switched on and off. Sell-in is the actual months, then the
 * recommendation planned on the current forecast (falling back to the initial
 * where the current does not reach), on last month's (Previous) forecast, and
 * on the initial alone (backend get_sell_in_outlook). The Previous and Initial
 * sell-in lines also run through the actual months, as what that forecast
 * would have recommended each month. Sell-out is the actual
 * months, the current forecast carrying on from them, and the Previous and
 * Initial forecasts across the whole window, so last months' sales can be read
 * against what was forecast for them. `actualsThrough` is the last actual month.
 *
 * @param {{ months: Array<{ month: string, sell_in_actual: number | null, sell_in_recommended: number | null, sell_in_previous: number | null, sell_in_initial: number | null, sell_out_actual: number | null, sell_out_forecast: number | null, sell_out_initial: number | null, sell_out_previous: number | null, forecast_source: 'current' | 'initial' | 'mixed' | null }>, actualsThrough: string | null }} props
 */
export default function SellInOutlookChart({ months, actualsThrough }) {
  const [visible, setVisible] = useState(ALL_VISIBLE);

  if (months.length === 0) {
    return <p className="text-sm text-deep-violet-blue/70">No actuals for these filters.</p>;
  }

  const lastIndex = months.findIndex((row) => row.month === actualsThrough);
  const next = months[lastIndex + 1];
  const nextIsCurrent = ['current', 'mixed'].includes(next?.forecast_source);
  const rows = months.map((row, index) => {
    return {
      ...row,
      label: formatMonth(row.month),
      sell_in_recommended:
        index === lastIndex && next?.sell_in_recommended != null ? row.sell_in_actual : row.sell_in_recommended,
      // The current sell-out line joins the actual too, when the month after it is on the current forecast.
      sell_out_current:
        index === lastIndex && nextIsCurrent
          ? row.sell_out_actual
          : row.forecast_source === 'current' || row.forecast_source === 'mixed'
            ? row.sell_out_forecast
            : null,
    };
  });

  // A line with no values in view (no Previous forecast yet) can't be switched on.
  const noData = Object.fromEntries(SERIES.map((series) => [series.key, !rows.some((row) => row[series.key] != null)]));
  const hints = Object.fromEntries(
    SERIES.filter((series) => noData[series.key]).map((series) => [
      series.key,
      series.dash === DASH.previous ? 'No previous forecast yet.' : 'No values for these filters.',
    ]),
  );

  const timings = lineSweepTimings(rows, TOOLTIP_ORDER, LINE_SWEEP);

  const formatRow = labelledTooltipRow(CHART_CONFIG, (value) => `${formatUnits(value)} units`);
  function formatTooltipRow(value, name, item, index, payload) {
    if (JOIN_KEYS.includes(name) && payload?.month === actualsThrough) return null;
    return formatRow(value, name, item);
  }

  const fallback = initialFallbackLabel(months);

  return (
    <div className="space-y-2">
      {/* The Forecast page's line pills and bar, one row each for sell-in and sell-out. */}
      <div className="space-y-1.5 rounded-lg border border-lavander bg-white px-3 py-2">
        {GROUPS.map((group) => (
          <ForecastLineToggle
            key={group.label}
            label={group.label}
            labelClassName="w-14 shrink-0"
            series={group.series}
            visible={visible}
            onToggle={(key) => setVisible((shown) => ({ ...shown, [key]: !shown[key] }))}
            hints={hints}
            disabled={noData}
          />
        ))}
      </div>

      <div className="overflow-visible rounded-xl border border-lavander bg-white pl-1 pr-3 pt-2">
        <ChartContainer config={CHART_CONFIG} className="aspect-auto h-[328px] w-full">
          <ComposedChart accessibilityLayer data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
            <CartesianGrid vertical={false} stroke="var(--aire-lavender)" />
            <XAxis
              dataKey="label"
              interval={0}
              height={52}
              tick={{ fontSize: 9, fill: '#3A4369' }}
              angle={-40}
              textAnchor="end"
              tickMargin={6}
            />
            <YAxis width={48} tick={{ fontSize: 10, fill: '#3A4369' }} tickFormatter={formatUnits} />
            <ChartTooltip
              wrapperStyle={{ zIndex: 10 }}
              itemSorter={(item) => TOOLTIP_ORDER.indexOf(item.dataKey)}
              content={<ChartTooltipContent className="border-violet/40 bg-white" formatter={formatTooltipRow} />}
            />
            {SERIES.map((series) => (
              <Line
                key={series.key}
                dataKey={series.key}
                hide={!visible[series.key] || noData[series.key]}
                stroke={`var(--color-${series.key})`}
                strokeWidth={2}
                strokeDasharray={series.dash}
                dot={series.dot ? timedDot(timings[series.key]) : false}
                connectNulls={false}
                {...timings[series.key]}
              />
            ))}
          </ComposedChart>
        </ChartContainer>
      </div>
      {fallback ? (
        <p className="text-[11px] text-deep-violet-blue/60">
          {fallback}: no current forecast yet, so the plan uses the Initial Yearly Sell-out Forecast for{' '}
          {fallback.includes('–') ? 'these months' : 'this month'}.
        </p>
      ) : null}
    </div>
  );
}
