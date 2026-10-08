'use client';

import { cn } from '@/lib/utils';
import { FORECAST_SERIES } from '@/app/utils/forecastView';

// Same colours as the Actual and Current lines above.
const ACTUAL_COLOR = FORECAST_SERIES.find((series) => series.key === 'actual')?.color ?? '#3A4369';
const FORECAST_COLOR = FORECAST_SERIES.find((series) => series.key === 'current')?.color ?? '#0D9488';

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

function SourceCell({ color, children }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {color ? (
        <span aria-hidden="true" className="size-1.5 rounded-full" style={{ backgroundColor: color }} />
      ) : null}
      {children}
    </span>
  );
}

function YearGroup({ year, divided }) {
  const rows = [];
  if (year.actualMonths) {
    rows.push({
      key: 'actual',
      label: `Actual · ${year.actualMonths} mo`,
      color: ACTUAL_COLOR,
      volume: year.volume.actual,
      revenue: year.revenue.actual,
      emphasis: false,
    });
  }
  if (year.forecastMonths) {
    rows.push({
      key: 'forecast',
      label: `Forecast · ${year.forecastMonths} mo`,
      color: FORECAST_COLOR,
      volume: year.volume.forecast,
      revenue: year.revenue.forecast,
      emphasis: false,
    });
  }
  rows.push({
    key: 'total',
    label: 'Total',
    color: null,
    volume: year.volume.total,
    revenue: year.revenue.total,
    emphasis: true,
  });

  return rows.map((row, index) => (
    <tr
      key={`${year.year}-${row.key}`}
      className={cn(
        'border-b border-lavander/80 bg-white hover:bg-cream/50',
        divided && index === 0 && 'border-t border-lavander'
      )}
    >
      {index === 0 ? (
        <td className="px-2 py-2 align-top font-medium" rowSpan={rows.length}>
          {year.year}
        </td>
      ) : null}
      <td
        className={cn(
          'px-2.5 py-2',
          row.emphasis ? 'font-medium' : 'text-[11px] text-deep-violet-blue/70'
        )}
      >
        <SourceCell color={row.color}>{row.label}</SourceCell>
      </td>
      <td
        className={cn(
          'px-1.5 py-2 tabular-nums',
          row.emphasis ? 'font-medium' : 'text-[11px] text-deep-violet-blue/70'
        )}
      >
        {formatVolume(row.volume)}
      </td>
      <td
        className={cn(
          'px-1.5 py-2 tabular-nums',
          row.emphasis ? 'font-medium' : 'text-[11px] text-deep-violet-blue/70'
        )}
        title={row.key === 'total' && year.revenue.total == null ? 'No catalog price for these SKUs' : undefined}
      >
        {formatRevenue(row.revenue)}
      </td>
    </tr>
  ));
}

/**
 * Volume and revenue totals for every calendar year the chart touches, shown
 * between the chart and its footer.
 *
 * Each year counts a month once -- its actual if sales have loaded, else the
 * Current forecast -- so Actual and Forecast rows split the year, and Total
 * underneath adds them. See buildYearlyTotals in app/utils/forecastView.js.
 *
 * @param {{ years: object[], loading?: boolean }} props
 */
export default function ForecastYearTotals({ years, loading = false }) {
  if (loading) {
    return <div className="h-[120px] animate-pulse rounded-lg border border-lavander bg-white" />;
  }

  if (!years.length) return null;

  return (
    <section aria-label="Full-year totals" className="rounded-lg border border-lavander bg-white p-3 shadow-sm">
      <div className="mb-2">
        <h3 className="font-serif text-base text-deep-violet-blue">Full-year totals</h3>
        <p className="text-[11px] text-deep-violet-blue/70">
          Actual sales where loaded, Current forecast for the remaining months
        </p>
      </div>

      <div className="overflow-x-auto rounded-md border border-lavander">
        <table className="w-full table-fixed text-left text-xs text-deep-violet-blue">
          <colgroup>
            <col className="w-[16%]" />
            <col className="w-[28%]" />
            <col />
            <col />
          </colgroup>
          <thead className="bg-cream">
            <tr className="border-b border-lavander">
              <th className="px-2.5 py-2 text-[10px] font-semibold uppercase tracking-wide text-deep-violet-blue/60">
                Year
              </th>
              <th className="px-2.5 py-2 text-[10px] font-semibold uppercase tracking-wide text-deep-violet-blue/60">
                Source
              </th>
              <th className="px-2.5 py-2 text-[10px] font-semibold uppercase tracking-wide text-deep-violet-blue/60">
                Volume
              </th>
              <th className="px-2.5 py-2 text-[10px] font-semibold uppercase tracking-wide text-deep-violet-blue/60">
                Revenue
              </th>
            </tr>
          </thead>
          <tbody>
            {years.map((year, index) => (
              <YearGroup key={year.year} year={year} divided={index > 0} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
