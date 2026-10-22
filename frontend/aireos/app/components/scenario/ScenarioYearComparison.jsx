'use client';

import { cn } from '@/lib/utils';
import { HEADER_RULE } from '@/components/forecast/ForecastYearTotals';

function formatFigure(value, metric) {
  if (value == null) return '—';
  const whole = Math.round(value).toLocaleString('en-US');
  return metric === 'revenue' ? `$${whole}` : whole;
}

function signedFigure(value, metric) {
  return `${value < 0 ? '−' : '+'}${formatFigure(Math.abs(value), metric)}`;
}

function blocksActiveLabel(count) {
  return `${count} ${count === 1 ? 'block' : 'blocks'} active`;
}

const headerCell = cn(
  'border-b bg-cream px-2.5 py-1.5 text-right text-[10px] font-bold uppercase tracking-wide text-deep-violet-blue',
  HEADER_RULE
);

/**
 * Scenario builder's comparison table, under the chart: one metric at a
 * time (the chart's Volume | Revenue), each year in view and the next 12
 * months, Current against Simulated with the change. Styled like
 * ForecastYearTotals, whose /forecast table it stands in for here.
 *
 * Until a switched-on block changes something in view (`rows` all carry
 * zero blocks), it shows Current only: no Simulated, Δ or Δ% columns.
 *
 * @param {{
 *   metric: 'units' | 'revenue',
 *   rows: Array<{ key: string, label: string, caption?: string,
 *     current: number | null, delta: number, blocks: number }>,
 *   loading?: boolean,
 * }} props
 */
export default function ScenarioYearComparison({ metric, rows, loading = false }) {
  if (loading) {
    return <div className="h-12 animate-pulse rounded-md border border-lavander bg-white" />;
  }
  if (!rows.length) return null;

  const compare = rows.some((row) => row.blocks > 0);

  return (
    <section aria-label="Current and simulated totals" className="overflow-x-auto rounded-md border border-lavander">
      <table className="w-full border-separate border-spacing-0 text-xs text-deep-violet-blue">
        <thead>
          <tr>
            <th className={cn(headerCell, 'text-left')}>Period</th>
            <th className={headerCell}>Current</th>
            {compare ? (
              <>
                <th className={headerCell}>Simulated</th>
                <th className={headerCell}>Δ</th>
                <th className={headerCell}>Δ%</th>
              </>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const rule = index < rows.length - 1 ? 'border-b border-lavander/70' : '';
            const changed = Boolean(row.delta) && row.current != null;
            const cell = cn('whitespace-nowrap px-2.5 py-1.5 text-right tabular-nums', rule);
            return (
              <tr key={row.key} className="bg-white">
                <td className={cn('whitespace-nowrap px-2.5 py-1.5 text-left', rule)}>
                  <span className="font-medium">{row.label}</span>
                  {row.caption ? (
                    <span className="ml-1.5 text-[10px] font-normal text-deep-violet-blue/50">{row.caption}</span>
                  ) : null}
                </td>
                <td className={cell}>{formatFigure(row.current, metric)}</td>
                {compare ? (
                  <>
                    <td className={cell}>
                      {row.blocks > 0 ? (
                        <span className="mr-1.5 inline-block rounded-full bg-scenario-soft px-2 py-px align-[1px] text-[10px] font-semibold text-scenario-ink">
                          {blocksActiveLabel(row.blocks)}
                        </span>
                      ) : null}
                      {row.current == null ? '—' : formatFigure(row.current + row.delta, metric)}
                    </td>
                    <td className={cn(cell, changed ? 'font-semibold text-scenario-ink' : 'text-deep-violet-blue/45')}>
                      {changed ? signedFigure(row.delta, metric) : '—'}
                    </td>
                    <td className={cn(cell, changed ? 'font-semibold text-scenario-ink' : 'text-deep-violet-blue/45')}>
                      {changed && row.current
                        ? `${row.delta < 0 ? '−' : '+'}${Math.abs((row.delta / row.current) * 100).toFixed(1)}%`
                        : '—'}
                    </td>
                  </>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

