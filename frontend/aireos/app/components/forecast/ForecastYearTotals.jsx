'use client';

import MobileRecordCard from '@/components/ui/MobileRecordCard';
import RecordCardList from '@/components/ui/RecordCardList';
import TableGrid from '@/components/ui/TableGrid';
import TableRow from '@/components/ui/TableRow';
import ForecastInfo from '@/components/forecast/ForecastInfo';
import { cn } from '@/lib/utils';

// Volume in cartons; the card's detail line says so, so the headings don't.
const COLUMNS = [
  { key: 'year', label: 'Year' },
  { key: 'actual', label: 'YTD actual', width: '9rem', align: 'right' },
  { key: 'forecast', label: 'Rest-of-year forecast', width: '9rem', align: 'right' },
  { key: 'total', label: 'Full year', width: '9rem', align: 'right' },
];

// The darker header line of the compact report table (Inventory's sell-in
// comparison); a step darker than their cream
// header, so the column lines still read on it.
export const HEADER_RULE = 'border-[#C5CBE0]';

const CELL_CLASS = 'px-4 py-2.5';
const NUMBER_CELL_CLASS = 'px-4 py-2.5 text-right tabular-nums';

export function formatVolume(value) {
  if (value == null) return '—';
  return Math.round(value).toLocaleString();
}

/**
 * "10 mo actual · 2 mo forecast" for a year row. `spelled` writes the unit out
 * ("1 month actual · 11 months forecast"): the Forecast page's own table has
 * the room, while the Scenario builder's narrower caption keeps "mo".
 *
 * @param {{ actualMonths?: number, partialMonths?: number, forecastMonths?: number }} year
 * @param {{ spelled?: boolean }} [options]
 */
export function mixCaption(year, { spelled = false } = {}) {
  const unit = (count) => (spelled ? (count === 1 ? 'month' : 'months') : 'mo');
  const parts = [];
  if (year.actualMonths) parts.push(`${year.actualMonths} ${unit(year.actualMonths)} actual`);
  // Some customer x SKUs reported, others still forecast (forecastYearTotals).
  if (year.partialMonths) parts.push(`${year.partialMonths} ${unit(year.partialMonths)} part actual`);
  if (year.forecastMonths) parts.push(`${year.forecastMonths} ${unit(year.forecastMonths)} forecast`);
  return parts.join(' · ');
}

/**
 * One row per calendar year under the chart: actual, forecast and the
 * combined total, in cartons (the Forecast page shows volume only), on the
 * shared TableGrid. Year figures come from
 * forecastYearTotals.buildYearlyTotals. Phones get one card per year.
 * Goes inside the page's TableCard.
 *
 * @param {{
 *   years: object[],
 *   loading?: boolean,
 * }} props
 */
export default function ForecastYearTotals({ years, loading = false }) {
  if (!loading && !years.length) return null;

  return (
    <div className="min-w-0">
      <div className="border-t border-lavander bg-cream/25 p-3 sm:hidden">
        {loading ? (
          <div className="h-24 animate-pulse rounded-lg border border-lavander bg-white" aria-label="Loading year totals" />
        ) : (
          <RecordCardList>
            {years.map((year) => (
              <MobileRecordCard
                key={year.year}
                title={String(year.year)}
                subtitle={mixCaption(year, { spelled: true }) || undefined}
                fields={[
                  { label: 'YTD', value: <span className="tabular-nums">{formatVolume(year.volume.actual)}</span> },
                  { label: 'MTG', value: <span className="tabular-nums">{formatVolume(year.volume.forecast)}</span> },
                  { label: 'Total', value: <span className="font-medium tabular-nums">{formatVolume(year.volume.total)}</span> },
                ]}
              />
            ))}
          </RecordCardList>
        )}
      </div>

      <div className="hidden sm:block">
        <TableGrid columns={COLUMNS} minWidth="36rem" isLoading={loading} skeletonRows={1}>
          {!loading && years.map((year) => {
            const mix = mixCaption(year, { spelled: true });
            return (
              <TableRow key={year.year} className="h-12 border-b border-lavander/80">
                <td className={cn(CELL_CLASS, 'truncate')}>
                  <span className="font-medium">{year.year}</span>
                  {mix ? <span className="ml-2 text-xs text-deep-violet-blue/55">{mix}</span> : null}
                  <ForecastInfo helpKey="yearRow" label="About the year total" className="ml-0.5 inline-flex align-middle" />
                </td>
                <td className={NUMBER_CELL_CLASS}>{formatVolume(year.volume.actual)}</td>
                <td className={NUMBER_CELL_CLASS}>{formatVolume(year.volume.forecast)}</td>
                <td className={cn(NUMBER_CELL_CLASS, 'font-medium')}>{formatVolume(year.volume.total)}</td>
              </TableRow>
            );
          })}
        </TableGrid>
      </div>
    </div>
  );
}
