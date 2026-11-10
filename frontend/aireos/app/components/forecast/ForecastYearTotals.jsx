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

export function mixCaption(year) {
  const parts = [];
  if (year.actualMonths) parts.push(`${year.actualMonths} mo actual`);
  // Some customer x SKUs reported, others still forecast (forecastYearTotals).
  if (year.partialMonths) parts.push(`${year.partialMonths} mo part actual`);
  if (year.forecastMonths) parts.push(`${year.forecastMonths} mo forecast`);
  return parts.join(' · ');
}

function ColumnWidths() {
  return (
    <colgroup>
      <col className="w-[34%]" />
      <col className="w-[22%]" />
      <col className="w-[22%]" />
      <col className="w-[22%]" />
    </colgroup>
  );
}

function SplitLabel({ children, emphasis = false }) {
  return (
    <th
      className={cn(
        'border-b border-l bg-cream px-2 py-1 text-right text-[10px] uppercase tracking-wide',
        emphasis ? 'font-extrabold text-deep-violet-blue' : 'font-bold text-deep-violet-blue/80',
        HEADER_RULE
      )}
    >
      {children}
    </th>
  );
}

function Amount({ value, emphasis = false, className }) {
  return (
    <td
      className={cn(
        'whitespace-nowrap border-l border-lavander/80 px-2 py-1 text-right tabular-nums',
        emphasis ? 'font-medium text-deep-violet-blue' : 'text-deep-violet-blue/75',
        className
      )}
    >
      {formatVolume(value)}
    </td>
  );
}

/**
 * One thin row per calendar year under the chart: actual, forecast and the
 * combined total, in cartons (the Forecast page shows volume only). The
 * next-12-month Current total (each SKU's whole Current line, from the
 * backend's `horizon`) sits in its own strip under the table, with no
 * actual/forecast split. Year figures come from
 * forecastYearTotals.buildYearlyTotals.
 *
 * @param {{
 *   years: object[],
 *   loading?: boolean,
 *   horizonVolume?: number | null,
 * }} props
 */
export default function ForecastYearTotals({ years, loading = false, horizonVolume = null }) {
  if (loading) {
    return <div className="mx-4 mb-3 h-12 animate-pulse rounded-md border border-lavander bg-white" />;
  }

  if (!years.length) return null;

  return (
    <div className="min-w-0">
      <div className="grid gap-2 border-t border-lavander p-3 sm:hidden">
        {years.map((year) => (
          <article key={year.year} className="rounded-lg border border-lavander bg-white p-3">
            <div className="mb-2 flex flex-wrap items-baseline gap-2 border-b border-lavander/70 pb-2">
              <h3 className="font-semibold text-deep-violet-blue">{year.year}</h3>
              <span className="text-[11px] text-deep-violet-blue/60">{mixCaption(year)}</span>
            </div>
            <dl className="min-w-0 space-y-1 text-xs">
              <dt className="font-semibold text-deep-violet-blue">Volume</dt>
              {SPLIT.map((column) => (
                <div key={column.key} className="flex justify-between gap-1">
                  <dt className="text-deep-violet-blue/60">{column.label}</dt>
                  <dd className="font-medium tabular-nums text-deep-violet-blue">{formatVolume(year.volume[column.key])}</dd>
                </div>
              ))}
            </dl>
          </article>
        ))}
        <div className="flex justify-between gap-3 rounded-lg border border-lavander bg-cream/50 p-3 text-xs text-deep-violet-blue">
          <p className="font-semibold">Next 12 months forecast</p>
          <p className="font-medium tabular-nums">{formatVolume(horizonVolume)}</p>
        </div>
      </div>
      <div className="hidden min-w-0 overflow-x-auto border-t border-lavander sm:block">
        <table className="w-full border-separate border-spacing-0 text-left text-xs text-deep-violet-blue">
          <ColumnWidths />
          <thead>
            <tr>
              <th rowSpan={2} className={cn('border-b bg-cream px-2.5 align-bottom pb-1 text-[10px] font-bold uppercase tracking-wide text-deep-violet-blue', HEADER_RULE)}>
                Year
              </th>
              <th
                colSpan={3}
                className={cn(
                  'border-b border-l bg-cream px-2 py-1.5 text-center text-[10px] font-bold uppercase tracking-wide text-deep-violet-blue',
                  HEADER_RULE
                )}
              >
                Volume
              </th>
            </tr>
            <tr>
              {SPLIT.map((column) => (
                <SplitLabel key={column.key} emphasis={column.key === 'total'}>
                  {column.label}
                </SplitLabel>
              ))}
            </tr>
          </thead>
          <tbody>
            {years.map((year, index) => {
              const mix = mixCaption(year);
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
                      key={column.key}
                      value={year.volume[column.key]}
                      emphasis={column.key === 'total'}
                      className={rowRule}
                    />
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="hidden min-w-0 overflow-x-auto border-t border-lavander bg-[#F7F4F1] sm:block">
        <table className="w-full border-separate border-spacing-0 text-left text-xs text-deep-violet-blue">
          <ColumnWidths />
          <tbody>
            <tr>
              <td className="whitespace-nowrap px-2.5 py-1 font-medium">Next 12 months forecast</td>
              <td colSpan={3} className={cn('border-l px-2 py-1 text-center font-medium tabular-nums', HEADER_RULE)}>
                {formatVolume(horizonVolume)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
