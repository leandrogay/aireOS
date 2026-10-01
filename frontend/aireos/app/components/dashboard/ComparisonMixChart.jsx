'use client';

import { useId } from 'react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip } from '@/components/ui/chart';
import { changePct, formatChangePct } from '@/app/utils/periodComparison';
import { formatColor as colorFor } from '@/app/utils/storeFormats';
import { HatchPattern, PeriodKeySwatch, PeriodSwatch, edgeColor, patternId } from '@/components/dashboard/PeriodTexture';
import {
  CHART_SIZE_CLASS,
  MAX_BAR_SIZE,
  bucketLabel,
  exactBucketLabel,
  formatAxisCurrency,
  sortFormatsByTotalDesc,
  xAxisProps,
} from '@/app/utils/trendChart';

// The comparison period is drawn in the same format colours as this period,
// hatched (see PeriodTexture): a 50% tint with stripes and an outline in the
// format's darker edge colour. This period's segments are solid with the
// same edge, so a pale segment (UNITY) still has a visible boundary.
function tintFor(format) {
  return `color-mix(in srgb, ${colorFor(format)} 50%, var(--card))`;
}

function formatMoney(value) {
  return `$${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

function ChangeCell({ current, baseline }) {
  const pct = current === null ? null : changePct(current, baseline);
  const color =
    pct === null || pct === 0 ? 'text-deep-violet-blue/60' : pct > 0 ? 'text-green-600' : 'text-red-600';
  return (
    <td className={`pl-3 text-right tabular-nums ${color}`}>
      {pct > 0 ? '▲ ' : pct < 0 ? '▼ ' : ''}
      {formatChangePct(pct)}
    </td>
  );
}

// One row per format — this period, the comparison and the change — and a
// Total row, as a small table: three short columns read more easily than
// eight stacked "format · period" lines. The value columns are headed by
// the hovered bar's exact dates, which also serve as the tooltip's title;
// colour squares appear only on the format rows, where colour means format.
function MixTooltip({ active, payload, formats }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const lines = formats.map((format) => ({
    format,
    current: row.currentFormats[format] ?? null,
    baseline: row.baselineFormats[format] ?? null,
  }));

  return (
    <div className="rounded-lg border border-lavander bg-white px-2.5 py-1.5 text-xs text-deep-violet-blue shadow-xl">
      <table>
        <thead>
          <tr className="align-bottom">
            <th />
            <th className="max-w-36 pb-1 pl-3 text-right font-medium leading-tight">{row.currentLabel}</th>
            <th className="max-w-36 pb-1 pl-3 text-right font-normal leading-tight text-deep-violet-blue/70">
              {row.baselineLabel ?? 'No comparison data'}
            </th>
            <th className="pb-1 pl-3 text-right font-normal text-deep-violet-blue/60">Change</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.format}>
              <td>
                <span className="flex items-center gap-1.5">
                  <PeriodSwatch color={colorFor(line.format)} />
                  {line.format}
                </span>
              </td>
              <td className="pl-3 text-right font-mono tabular-nums">
                {line.current === null ? '—' : formatMoney(line.current)}
              </td>
              <td className="pl-3 text-right font-mono tabular-nums text-deep-violet-blue/70">
                {line.baseline === null ? '—' : formatMoney(line.baseline)}
              </td>
              <ChangeCell current={line.current} baseline={line.baseline} />
            </tr>
          ))}
          <tr className="border-t border-lavander font-semibold">
            <td className="pt-1">Total</td>
            <td className="pl-3 pt-1 text-right font-mono tabular-nums">
              {row.currentTotal === null ? 'No data' : formatMoney(row.currentTotal)}
            </td>
            <td className="pl-3 pt-1 text-right font-mono tabular-nums text-deep-violet-blue/70">
              {row.baselineTotal === null ? 'No data' : formatMoney(row.baselineTotal)}
            </td>
            <ChangeCell current={row.currentTotal} baseline={row.baselineTotal} />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// Formats once, then a single solid-vs-hatched key for the two periods —
// instead of eight "format · period" legend entries. The key uses the
// neutral period colour so it isn't read as a ninth format, and lists the
// comparison first, matching the bars (comparison stack on the left).
function MixLegend({ formats, names }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 pt-2 text-xs text-deep-violet-blue">
      {formats.map((format) => (
        <span key={format} className="flex items-center gap-1.5">
          <PeriodSwatch color={colorFor(format)} />
          {format}
        </span>
      ))}
      <span className="flex items-center gap-3 border-l border-lavander pl-4 text-deep-violet-blue/70">
        <span className="flex items-center gap-1.5">
          <PeriodKeySwatch hatched />
          {names.baseline}
        </span>
        <span className="flex items-center gap-1.5">
          <PeriodKeySwatch />
          {names.current}
        </span>
      </span>
    </div>
  );
}

/**
 * The comparison chart's "By format" view: per bucket, the comparison
 * period's stack (hatched, left) beside this period's (solid, right), each
 * split by store format. `rows` come from alignComparisonBuckets, whose
 * `currentFormats` / `baselineFormats` hold revenue per format for the
 * paired weeks, so both stacks cover exactly matching weeks.
 *
 * @param {{
 *   rows: Array<{ axisStart: string, current: object | null, baseline: object | null,
 *     currentFormats: Record<string, number>, baselineFormats: Record<string, number> }>,
 *   periodNames: { current: string, baseline: string },
 *   granularity: 'week' | 'month',
 * }} props
 */
export default function ComparisonMixChart({ rows, periodNames, granularity }) {
  const baseId = useId();
  const formats = sortFormatsByTotalDesc(
    rows
      .flatMap((row) => [...Object.entries(row.currentFormats), ...Object.entries(row.baselineFormats)])
      .map(([format, revenue]) => ({ format, revenue })),
  );
  const names = { current: periodNames?.current || 'This period', baseline: periodNames?.baseline || 'Comparison' };
  const chartData = rows.map((row) => {
    const point = {
      axisLabel: bucketLabel(granularity, row.axisStart),
      currentLabel: exactBucketLabel(granularity, row.axisStart),
      baselineLabel: row.baseline?.label ?? null,
      currentTotal: row.current?.revenue ?? null,
      baselineTotal: row.baseline?.revenue ?? null,
      currentFormats: row.currentFormats,
      baselineFormats: row.baselineFormats,
    };
    for (const format of formats) {
      point[`baseline_${format}`] = row.baselineFormats[format] ?? null;
      point[`current_${format}`] = row.currentFormats[format] ?? null;
    }
    return point;
  });

  return (
    <>
      <ChartContainer config={{}} className={CHART_SIZE_CLASS}>
        <BarChart accessibilityLayer data={chartData} margin={{ bottom: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="axisLabel" {...xAxisProps(chartData.length, granularity)} />
          <YAxis tickFormatter={formatAxisCurrency} width={50} tick={{ fontSize: 10 }} />
          <ChartTooltip content={<MixTooltip formats={formats} />} />
          <defs>
            {formats.map((format) => (
              <HatchPattern
                key={format}
                id={patternId(baseId, format)}
                tint={tintFor(format)}
                stripe={edgeColor(colorFor(format))}
              />
            ))}
          </defs>
          {/* Recharts places stacks left to right in the order their first
              bar is rendered: comparison first, matching the Total view. */}
          {formats.map((format) => (
            <Bar
              key={`baseline_${format}`}
              dataKey={`baseline_${format}`}
              stackId="baseline"
              fill={`url(#${patternId(baseId, format)})`}
              stroke={edgeColor(colorFor(format))}
              strokeWidth={1}
              maxBarSize={MAX_BAR_SIZE}
              isAnimationActive={false}
            />
          ))}
          {formats.map((format) => (
            <Bar
              key={`current_${format}`}
              dataKey={`current_${format}`}
              stackId="current"
              fill={colorFor(format)}
              stroke={edgeColor(colorFor(format))}
              strokeWidth={1}
              maxBarSize={MAX_BAR_SIZE}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ChartContainer>
      <MixLegend formats={formats} names={names} />
    </>
  );
}
