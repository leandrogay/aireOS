'use client';

import { useMemo, useState } from 'react';

import HeaderCheckboxFilter from '@/components/ui/HeaderCheckboxFilter';
import TableCard from '@/components/ui/TableCard';
import TableCardHeader from '@/components/ui/TableCardHeader';
import {
  TABLE_MISSING_HINT,
  TABLE_MISSING_LABEL,
  TABLE_PARTIAL_HINT,
  TABLE_PARTIAL_LABEL,
} from '@/app/utils/forecastLineText';
import { FORECAST_SERIES, uniqueMonthOptions } from '@/app/utils/forecastView';

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
      <span className="text-ink-soft" title={TABLE_MISSING_HINT}>
        {TABLE_MISSING_LABEL}
      </span>
    );
  }
  const value = formatTableValue(point[seriesKey]);
  if (seriesKey === 'actual' && point.actualKind === 'partial') {
    return (
      <span title={TABLE_PARTIAL_HINT}>
        {value} <span className="text-[11px] text-ink-soft">{TABLE_PARTIAL_LABEL}</span>
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
  const [openFilter, setOpenFilter] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const monthOptions = useMemo(() => uniqueMonthOptions(points), [points]);
  const visibleColumns = FORECAST_SERIES.filter((series) => visibleSeries[series.key]);

  const activeMonthFilter = useMemo(() => {
    const valid = new Set(monthOptions.map((option) => option.value));
    return monthFilter.filter((value) => valid.has(value));
  }, [monthFilter, monthOptions]);
  const hasTableFilters = activeMonthFilter.length > 0;

  const rows = useMemo(
    () =>
      points.filter((point) => {
        if (activeMonthFilter.length && !activeMonthFilter.includes(point.month_year)) return false;
        return true;
      }),
    [points, activeMonthFilter]
  );

  function clearTableFilters() {
    setMonthFilter([]);
    setOpenFilter(null);
  }

  return (
    <TableCard
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
                  openId={openFilter}
                  setOpenId={setOpenFilter}
                  onChange={setMonthFilter}
                />
              </div>
              <button
                type="button"
                onClick={clearTableFilters}
                disabled={!hasTableFilters}
                className="rounded-glass-sm border border-deep-violet-blue/30 bg-white px-3 py-1 text-xs font-medium text-deep-violet-blue transition hover:bg-cream disabled:cursor-not-allowed disabled:opacity-40"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => setExpanded((current) => !current)}
                className="rounded-glass-sm border border-deep-violet-blue/30 bg-white px-3 py-1 text-xs font-medium text-deep-violet-blue transition hover:bg-cream"
              >
                {expanded ? 'Collapse' : 'Expand'}
              </button>
            </>
          )}
        />
      )}
    >

      <div className={`${expanded ? '' : 'max-h-[55vh]'} overflow-y-auto border-t border-lavander sm:hidden`} aria-label="Monthly forecast values">
        {rows.length === 0 ? (
          <p className="p-4 text-sm text-ink-soft">No rows match these table filters.</p>
        ) : rows.map((point) => (
          <article key={point.month_year} className="border-b border-lavander/70 p-3 last:border-b-0 even:bg-cream/30">
            <h4 className="mb-2 font-semibold text-deep-violet-blue">{point.label}</h4>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
              {visibleColumns.map((series) => (
                <div key={series.key} className="min-w-0">
                  <dt className="text-[11px] font-semibold uppercase leading-tight tracking-wide text-ink-soft">{series.label}</dt>
                  <dd className="mt-0.5 text-sm font-medium tabular-nums text-deep-violet-blue"><CellValue point={point} seriesKey={series.key} /></dd>
                </div>
              ))}
            </dl>
          </article>
        ))}
      </div>

      <div className="hidden min-w-0 overflow-x-auto border-t border-lavander sm:block">
        <div className={expanded ? '' : 'max-h-[28vh] overflow-y-auto'}>
          <table className="aire-table-rows w-full min-w-[44rem] table-fixed text-left text-xs text-deep-violet-blue">
            <colgroup>
              <col className="w-[16%]" />
              {visibleColumns.map((series) => (
                <col key={series.key} />
              ))}
            </colgroup>
            <thead className="sticky top-0 z-10 bg-cream">
              <tr className="border-b border-lavander">
                <th className="px-1.5 py-2">
                  <HeaderCheckboxFilter
                    id="month"
                    label="Month"
                    selected={activeMonthFilter}
                    options={monthOptions}
                    openId={openFilter}
                    setOpenId={setOpenFilter}
                    onChange={setMonthFilter}
                  />
                </th>
                {visibleColumns.map((series) => (
                  <th
                    key={series.key}
                    className="px-2.5 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-ink-soft"
                  >
                    {series.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td className="px-2.5 py-3 text-deep-violet-blue/80" colSpan={visibleColumns.length + 1}>
                    No rows match these table filters.
                  </td>
                </tr>
              ) : (
                rows.map((point) => (
                  <tr
                    key={point.month_year}
                    className="h-10 border-b border-lavander/80 last:border-b-0"
                  >
                    <td className="whitespace-nowrap px-2.5 py-2 font-medium">{point.label}</td>
                    {visibleColumns.map((series) => (
                      <td key={series.key} className="px-2.5 py-2 text-right tabular-nums">
                        <CellValue point={point} seriesKey={series.key} />
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </TableCard>
  );
}
