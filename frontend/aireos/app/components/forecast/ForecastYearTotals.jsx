'use client';

import { cn } from '@/lib/utils';

const SPLIT = [
  { key: 'actual', label: 'Actual' },
  { key: 'forecast', label: 'Forecast' },
  { key: 'total', label: 'Total' },
];

// A step darker than the cream header, so the column lines still read on it.
export const HEADER_RULE = 'border-[#C5CBE0]';

function formatVolume(value) {
  if (value == null) return '—';
  return Math.round(value).toLocaleString();
}

function formatRevenue(value) {
  if (value == null) return '—';
  return `$${Number(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function mixCaption(year) {
  const parts = [];
  if (year.actualMonths) parts.push(`${year.actualMonths} mo actual`);
  if (year.forecastMonths) parts.push(`${year.forecastMonths} mo forecast`);
  return parts.join(' · ');
}

function ColumnWidths() {
  return (
    <colgroup>
      <col className="w-[18%]" />
      <col className="w-[13.66%]" />
      <col className="w-[13.66%]" />
      <col className="w-[13.66%]" />
      <col className="w-[13.66%]" />
      <col className="w-[13.66%]" />
      <col className="w-[13.7%]" />
    </colgroup>
  );
}

function GroupLabel({ children }) {
  return (
    <th
      colSpan={3}
      className={cn(
        'border-b border-l bg-cream px-2 py-1.5 text-center text-[10px] font-bold uppercase tracking-wide text-deep-violet-blue',
        HEADER_RULE
      )}
    >
      {children}
    </th>
  );
}

function SplitLabel({ children, emphasis = false, className }) {
  return (
    <th
      className={cn(
        'border-b border-l bg-cream px-2 py-1 text-right text-[10px] uppercase tracking-wide',
        emphasis ? 'font-extrabold text-deep-violet-blue' : 'font-bold text-deep-violet-blue/80',
        HEADER_RULE,
        className
      )}
    >
      {children}
    </th>
  );
}

function Amount({ value, format, emphasis = false, className, title }) {
  return (
    <td
      title={title}
      className={cn(
        'whitespace-nowrap border-l border-lavander/80 px-2 py-1 text-right tabular-nums',
        emphasis ? 'font-medium text-deep-violet-blue' : 'text-deep-violet-blue/75',
        className
      )}
    >
      {format(value)}
    </td>
  );
}

function signed(value, format) {
  if (!value) return null;
  return `${value > 0 ? '+' : '−'}${format(Math.abs(value))}`;
}

function SimulatedRow({ year, className }) {
  const change = {
    volume: signed(year.deltaUnits, formatVolume),
    revenue: signed(year.deltaRevenue, formatRevenue),
  };
  return (
    <tr className="bg-scenario-soft text-scenario-ink">
      <td className={cn('whitespace-nowrap px-2.5 py-1 align-middle font-medium', className)}>Simulated</td>
      {['volume', 'revenue'].flatMap((group) =>
        SPLIT.map((column) => (
          <td
            key={`${group}-${column.key}`}
            className={cn(
              'whitespace-nowrap border-l border-lavander/80 px-2 py-1 text-right tabular-nums',
              column.key === 'total' && 'font-medium',
              className
            )}
          >
            {(group === 'volume' ? formatVolume : formatRevenue)(year[group][column.key])}
            {column.key !== 'actual' && change[group] ? (
              <span className="ml-1 text-[10px] opacity-75">{change[group]}</span>
            ) : null}
          </td>
        ))
      )}
    </tr>
  );
}

/**
 * One thin row per calendar year under the chart: actual, forecast and the
 * combined total for volume and revenue. The next-12-month Current total
 * (sumHorizonForecast) sits in its own strip under the table, with no
 * actual/forecast split. Year figures come from buildYearlyTotals.
 *
 * `simulatedYears` (Scenario builder only) adds a tinted "Simulated" row
 * under each year, with the draft's change against Current beside the
 * forecast and total (scenarioEngine.simulatedYearTotals).
 *
 * @param {{
 *   years: object[],
 *   simulatedYears?: object[],
 *   loading?: boolean,
 *   horizonVolume?: number | null,
 *   horizonRevenue?: number | null,
 * }} props
 */
export default function ForecastYearTotals({
  years,
  loading = false,
  horizonVolume = null,
  horizonRevenue = null,
  simulatedYears = [],
}) {
  if (loading) {
    return <div className="h-12 animate-pulse rounded-md border border-lavander bg-white" />;
  }

  if (!years.length) return null;

  const simulatedByYear = new Map(simulatedYears.map((year) => [year.year, year]));

  return (
    <section aria-label="Full-year totals" className="min-w-0 space-y-1.5">
      <div className="grid gap-2 sm:hidden">
        {years.map((year) => (
          <article key={year.year} className="rounded-lg border border-lavander bg-white p-3">
            <div className="mb-2 flex flex-wrap items-baseline gap-2 border-b border-lavander/70 pb-2">
              <h3 className="font-semibold text-deep-violet-blue">{year.year}</h3>
              <span className="text-[11px] text-deep-violet-blue/60">{mixCaption(year)}</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[{ label: 'Volume', values: year.volume, format: formatVolume }, { label: 'Revenue', values: year.revenue, format: formatRevenue }].map((group) => (
                <dl key={group.label} className="min-w-0 space-y-1 text-xs">
                  <dt className="font-semibold text-deep-violet-blue">{group.label}</dt>
                  {SPLIT.map((column) => (
                    <div key={column.key} className="flex justify-between gap-1">
                      <dt className="text-deep-violet-blue/60">{column.label}</dt>
                      <dd className="font-medium tabular-nums text-deep-violet-blue">{group.format(group.values[column.key])}</dd>
                    </div>
                  ))}
                </dl>
              ))}
            </div>
            {simulatedByYear.has(year.year) && (
              <div className="mt-3 grid grid-cols-2 gap-3 rounded-md bg-scenario-soft p-2 text-xs text-scenario-ink">
                <div><p className="font-semibold">Simulated volume</p><p className="tabular-nums">{formatVolume(simulatedByYear.get(year.year).volume.total)}</p><p className="opacity-75">{signed(simulatedByYear.get(year.year).deltaUnits, formatVolume)}</p></div>
                <div><p className="font-semibold">Simulated revenue</p><p className="tabular-nums">{formatRevenue(simulatedByYear.get(year.year).revenue.total)}</p><p className="opacity-75">{signed(simulatedByYear.get(year.year).deltaRevenue, formatRevenue)}</p></div>
              </div>
            )}
          </article>
        ))}
        <div className="rounded-lg border border-lavander bg-cream/50 p-3 text-xs text-deep-violet-blue">
          <p className="mb-2 font-semibold">Next 12 months forecast</p>
          <dl className="grid grid-cols-2 gap-3">
            <div><dt className="text-deep-violet-blue/60">Volume</dt><dd className="font-medium tabular-nums">{formatVolume(horizonVolume)}</dd></div>
            <div><dt className="text-deep-violet-blue/60">Revenue</dt><dd className="font-medium tabular-nums">{formatRevenue(horizonRevenue)}</dd></div>
          </dl>
        </div>
      </div>
      <div className="hidden min-w-0 overflow-x-auto rounded-md border border-lavander sm:block">
      <table className="w-full border-separate border-spacing-0 text-left text-xs text-deep-violet-blue">
        <ColumnWidths />
        <thead>
          <tr>
            <th rowSpan={2} className={cn('border-b bg-cream px-2.5 align-bottom pb-1 text-[10px] font-bold uppercase tracking-wide text-deep-violet-blue', HEADER_RULE)}>
              Year
            </th>
            <GroupLabel>Volume</GroupLabel>
            <GroupLabel>Revenue</GroupLabel>
          </tr>
          <tr>
            {SPLIT.map((column) => (
              <SplitLabel key={`vol-${column.key}`} emphasis={column.key === 'total'}>
                {column.label}
              </SplitLabel>
            ))}
            {SPLIT.map((column) => (
              <SplitLabel key={`rev-${column.key}`} emphasis={column.key === 'total'}>
                {column.label}
              </SplitLabel>
            ))}
          </tr>
        </thead>
        <tbody>
          {years.map((year, index) => {
            const mix = mixCaption(year);
            const revenueMissing = year.revenue.total == null;
            const simulated = simulatedYears.find((item) => item.year === year.year);
            const rowRule = index < years.length - 1 || simulated ? 'border-b border-lavander/70' : '';
            return [
              <tr key={year.year} className="bg-white">
                <td className={cn('whitespace-nowrap px-2.5 py-1 align-middle', rowRule)}>
                  <span className="font-medium">{year.year}</span>
                  {mix ? (
                    <span className="ml-1.5 text-[10px] font-normal text-deep-violet-blue/50">{mix}</span>
                  ) : null}
                </td>
                {SPLIT.map((column) => (
                  <Amount
                    key={`vol-${column.key}`}
                    value={year.volume[column.key]}
                    format={formatVolume}
                    emphasis={column.key === 'total'}
                    className={rowRule}
                  />
                ))}
                {SPLIT.map((column) => (
                  <Amount
                    key={`rev-${column.key}`}
                    value={year.revenue[column.key]}
                    format={formatRevenue}
                    emphasis={column.key === 'total'}
                    className={rowRule}
                    title={revenueMissing ? 'No catalog price for these SKUs' : undefined}
                  />
                ))}
              </tr>,
              simulated ? (
                <SimulatedRow
                  key={`${year.year}-simulated`}
                  year={simulated}
                  className={index < years.length - 1 ? 'border-b border-lavander/70' : ''}
                />
              ) : null,
            ];
          })}
        </tbody>
      </table>
      </div>
      <div className="hidden min-w-0 overflow-x-auto rounded-md bg-[#F7F4F1] sm:block">
        <table className="w-full border-separate border-spacing-0 text-left text-xs text-deep-violet-blue">
          <ColumnWidths />
          <tbody>
            <tr>
              <td className="whitespace-nowrap px-2.5 py-1 font-medium">Next 12 months forecast</td>
              <td colSpan={3} className={cn('border-l px-2 py-1 text-center font-medium tabular-nums', HEADER_RULE)}>
                {formatVolume(horizonVolume)}
              </td>
              <td colSpan={3} className={cn('border-l px-2 py-1 text-center font-medium tabular-nums', HEADER_RULE)}>
                {formatRevenue(horizonRevenue)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
