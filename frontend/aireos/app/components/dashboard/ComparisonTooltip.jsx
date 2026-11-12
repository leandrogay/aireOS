'use client';

import { changePct, formatChangePct } from '@/app/utils/periodComparison';
import { UNNAMED_FORMAT } from '@/app/utils/storeFormats';
import { PeriodSwatch } from '@/components/dashboard/PeriodTexture';
import { formatMetric } from '@/app/utils/trendChart';
import { CHART_TOOLTIP_CLASS } from '@/components/ui/ChartFrame';
import { cn } from '@/lib/utils';

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

/**
 * The comparison charts' hover card (ComparisonMixChart's bars and
 * ComparisonLineChart's lines): one row per store format -- this period, the
 * comparison and the change -- and a Total row, as a small table: three
 * short columns read more easily than eight stacked "format · period" lines.
 * The value columns are headed by the hovered bucket's exact dates, which
 * also serve as the title; colour squares appear only on the format rows,
 * where colour means format. A channel with one unnamed format shows only
 * the Total row.
 *
 * Reads the hovered point's `currentLabel`, `baselineLabel`, `currentTotal`,
 * `baselineTotal`, `currentFormats` and `baselineFormats`.
 *
 * @param {{ active?: boolean, payload?: Array<object>, formats: string[], metric: 'revenue' | 'units', colorFor: (format: string) => string }} props
 */
export default function ComparisonTooltip({ active, payload, formats, metric, colorFor }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const lines = formats.map((format) => ({
    format,
    current: row.currentFormats[format] ?? null,
    baseline: row.baselineFormats[format] ?? null,
  }));

  return (
    // ChartTooltipContent's box in the shared tooltip look, holding this table.
    <div className={cn('rounded-lg border px-2.5 py-1.5 text-xs text-deep-violet-blue shadow-xl', CHART_TOOLTIP_CLASS)}>
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
          {lines.filter((line) => line.format !== UNNAMED_FORMAT).map((line) => (
            <tr key={line.format}>
              <td>
                <span className="flex items-center gap-1.5">
                  <PeriodSwatch color={colorFor(line.format)} />
                  {line.format}
                </span>
              </td>
              <td className="pl-3 text-right font-mono tabular-nums">
                {line.current === null ? '—' : formatMetric(metric, line.current)}
              </td>
              <td className="pl-3 text-right font-mono tabular-nums text-deep-violet-blue/70">
                {line.baseline === null ? '—' : formatMetric(metric, line.baseline)}
              </td>
              <ChangeCell current={line.current} baseline={line.baseline} />
            </tr>
          ))}
          <tr className="border-t border-lavander font-semibold">
            <td className="pt-1">Total</td>
            <td className="pl-3 pt-1 text-right font-mono tabular-nums">
              {row.currentTotal === null ? 'No data' : formatMetric(metric, row.currentTotal)}
            </td>
            <td className="pl-3 pt-1 text-right font-mono tabular-nums text-deep-violet-blue/70">
              {row.baselineTotal === null ? 'No data' : formatMetric(metric, row.baselineTotal)}
            </td>
            <ChangeCell current={row.currentTotal} baseline={row.baselineTotal} />
          </tr>
        </tbody>
      </table>
    </div>
  );
}
