'use client';

import { useState } from 'react';

import HeaderCheckboxFilter from '@/components/ui/HeaderCheckboxFilter';
import MobileRecordCard from '@/components/ui/MobileRecordCard';
import RecordCardList from '@/components/ui/RecordCardList';
import TableCard from '@/components/ui/TableCard';
import TableCardHeader from '@/components/ui/TableCardHeader';
import TableGrid from '@/components/ui/TableGrid';
import TableRow from '@/components/ui/TableRow';
import { cn } from '@/lib/utils';
import {
  TABLE_MISSING_HINT,
  TABLE_MISSING_LABEL,
  TABLE_PARTIAL_HINT,
  TABLE_PARTIAL_LABEL,
} from '@/app/utils/forecastLineText';
import { FORECAST_SERIES, uniqueMonthOptions } from '@/app/utils/forecastView';

const NO_MATCHES = 'No rows match these table filters.';

// Cartons, whole numbers.
function formatTableValue(value) {
  if (value == null) return '—';
  return Math.round(value).toLocaleString();
}

/**
 * One cell's value. A month whose sales file is missing reads "Missing"
 * (muted), never "—" or 0; a partly reported month keeps its sum with a
 * muted "partial" (forecastActuals.actualKind).
 */
function CellValue({ point, seriesKey }) {
  if (seriesKey === 'actual' && point.actualKind === 'missing') {
    return (
      <span className="text-deep-violet-blue/45" title={TABLE_MISSING_HINT}>
        {TABLE_MISSING_LABEL}
      </span>
    );
  }
  const value = formatTableValue(point[seriesKey]);
  if (seriesKey === 'actual' && point.actualKind === 'partial') {
    return (
      <span title={TABLE_PARTIAL_HINT}>
        {value} <span className="text-[10px] text-deep-violet-blue/45">{TABLE_PARTIAL_LABEL}</span>
      </span>
    );
  }
  return value;
}

/**
 * Month-by-month values of the lines on the chart, for the model the chart
 * shows (`modelLabel`, e.g. "Tier 0 · Baseline"): `points` are already that
 * one tier's (utils/forecastTiers.js), so the table has no per-month model.
 *
 * @param {{ points: object[], visibleSeries: Record<string, boolean>, modelLabel?: string }} props
 */
export default function ForecastTable({ points, visibleSeries, modelLabel = '' }) {
  const [monthFilter, setMonthFilter] = useState([]);
  // The phone view's Month filter, above the cards (the table's is in its header).
  const [openMobileFilter, setOpenMobileFilter] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const monthOptions = uniqueMonthOptions(points);
  const visibleColumns = FORECAST_SERIES.filter((series) => visibleSeries[series.key]);

  const validMonths = new Set(monthOptions.map((option) => option.value));
  const activeMonthFilter = monthFilter.filter((value) => validMonths.has(value));
  const hasTableFilters = activeMonthFilter.length > 0;
  const rows = hasTableFilters
    ? points.filter((point) => activeMonthFilter.includes(point.month_year))
    : points;

  const columns = [
    {
      key: 'month',
      label: 'Month',
      width: '16%',
      filter: { selected: activeMonthFilter, options: monthOptions, onChange: setMonthFilter },
    },
    ...visibleColumns.map((series) => ({ key: series.key, label: series.label, align: 'right' })),
  ];

  function clearTableFilters() {
    setMonthFilter([]);
    setOpenMobileFilter(null);
  }

  return (
    <TableCard
      variant="glass"
      label="Monthly forecast values"
      header={(
        <TableCardHeader
          title="Monthly values"
          detail={<>{rows.length} of {points.length} months shown{modelLabel ? ` · ${modelLabel}` : ''}</>}
          actions={(
            <>
              <div className="sm:hidden">
                <HeaderCheckboxFilter
                  id="month-mobile"
                  label="Month"
                  selected={activeMonthFilter}
                  options={monthOptions}
                  openId={openMobileFilter}
                  setOpenId={setOpenMobileFilter}
                  onChange={setMonthFilter}
                />
              </div>
              <button
                type="button"
                onClick={clearTableFilters}
                disabled={!hasTableFilters}
                className="rounded-md border border-deep-violet-blue/30 bg-white px-3 py-1 text-xs font-medium text-deep-violet-blue transition hover:bg-cream disabled:cursor-not-allowed disabled:opacity-40"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => setExpanded((current) => !current)}
                className="rounded-md border border-deep-violet-blue/30 bg-white px-3 py-1 text-xs font-medium text-deep-violet-blue transition hover:bg-cream"
              >
                {expanded ? 'Collapse' : 'Expand'}
              </button>
            </>
          )}
        />
      )}
    >
      <div
        className={cn('overflow-y-auto border-t border-lavander bg-cream/25 p-3 sm:hidden', !expanded && 'max-h-[55vh]')}
        aria-label="Monthly forecast values"
      >
        {rows.length === 0 ? (
          <p className="rounded-lg border border-lavander bg-white p-6 text-center text-sm text-deep-violet-blue/70">{NO_MATCHES}</p>
        ) : (
          <RecordCardList>
            {rows.map((point) => (
              <MobileRecordCard
                key={point.month_year}
                title={point.label}
                fields={visibleColumns.map((series) => ({
                  label: series.label,
                  value: <span className="tabular-nums"><CellValue point={point} seriesKey={series.key} /></span>,
                }))}
              />
            ))}
          </RecordCardList>
        )}
      </div>

      {/* Collapsed, the table scrolls inside a short box under its sticky
          header; expanded, it shows every month. */}
      <div className={cn('hidden min-h-0 flex-col sm:flex', !expanded && 'max-h-[28vh]')}>
        <TableGrid
          columns={columns}
          minWidth="56rem"
          emptyState={rows.length === 0 ? NO_MATCHES : null}
        >
          {rows.map((point) => (
            <TableRow key={point.month_year} className="h-12 border-b border-lavander/80">
              <td className="px-4 py-2.5 font-medium">{point.label}</td>
              {visibleColumns.map((series) => (
                <td key={series.key} className="px-4 py-2.5 text-right tabular-nums">
                  <CellValue point={point} seriesKey={series.key} />
                </td>
              ))}
            </TableRow>
          ))}
        </TableGrid>
      </div>
    </TableCard>
  );
}
