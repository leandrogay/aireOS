'use client';

import { cn } from '@/lib/utils';

const SPLIT = [
  { key: 'actual', label: 'Actual' },
  { key: 'forecast', label: 'Forecast' },
  { key: 'total', label: 'Total' },
];

// A step darker than the cream header, so the column lines still read on it.
const HEADER_RULE = 'border-[#C5CBE0]';

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

function mixCaption(year) {
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

/**
 * One thin row per calendar year under the chart: actual, forecast and the
 * combined total for volume and revenue. The next-12-month Current total
 * (sumHorizonForecast) sits in its own strip under the table, with no
 * actual/forecast split. Year figures come from buildYearlyTotals.
 *
 * @param {{
 *   years: object[],
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
}) {
  if (loading) {
    return <div className="h-12 animate-pulse rounded-md border border-lavander bg-white" />;
  }

  if (!years.length) return null;

  return (
    <section aria-label="Full-year totals" className="space-y-1.5">
      <div className="overflow-x-auto rounded-md border border-lavander">
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
            const rowRule = index < years.length - 1 ? 'border-b border-lavander/70' : '';
            return (
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
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
      <div className="overflow-x-auto rounded-md bg-[#F7F4F1]">
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
