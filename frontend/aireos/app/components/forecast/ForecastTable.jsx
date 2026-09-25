'use client';

import { useMemo, useState } from 'react';

import { cn } from '@/lib/utils';
import { promoTypeLabel } from '@/app/utils/promotionForm';
import HeaderCheckboxFilter from '@/components/forecast/HeaderCheckboxFilter';
import {
  FORECAST_SERIES,
  monthHasPromoType,
  promoBadgeClass,
  uniqueMonthOptions,
  uniquePromoOptions,
} from '@/app/utils/forecastView';

function formatTableValue(value, metric) {
  if (value == null) return '—';
  if (metric === 'revenue') {
    return `$${Number(value).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
  return Math.round(value).toLocaleString();
}

export default function ForecastTable({ points, metric, promoType, visibleSeries }) {
  const [monthFilter, setMonthFilter] = useState([]);
  const [promoFilter, setPromoFilter] = useState([]);
  const [openFilter, setOpenFilter] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const monthOptions = useMemo(() => uniqueMonthOptions(points), [points]);
  const promoOptions = useMemo(
    () =>
      uniquePromoOptions(points).map((value) => ({
        value,
        label: promoTypeLabel(value),
      })),
    [points]
  );
  const visibleColumns = FORECAST_SERIES.filter((series) => visibleSeries[series.key]);

  // A selected month/promo can outlive the points it came from (a new SKU/date
  // range no longer has it) -- drop those here at render time instead of
  // syncing state to it in an effect.
  const activeMonthFilter = useMemo(() => {
    const valid = new Set(monthOptions.map((option) => option.value));
    return monthFilter.filter((value) => valid.has(value));
  }, [monthFilter, monthOptions]);
  const activePromoFilter = useMemo(() => {
    const valid = new Set(promoOptions.map((option) => option.value));
    return promoFilter.filter((value) => valid.has(value));
  }, [promoFilter, promoOptions]);
  const hasTableFilters = activeMonthFilter.length > 0 || activePromoFilter.length > 0;

  const rows = useMemo(
    () =>
      points.filter((point) => {
        if (activeMonthFilter.length && !activeMonthFilter.includes(point.month_year)) return false;
        if (activePromoFilter.length && !activePromoFilter.some((type) => monthHasPromoType(point, type))) {
          return false;
        }
        return true;
      }),
    [points, activeMonthFilter, activePromoFilter]
  );

  function clearTableFilters() {
    setMonthFilter([]);
    setPromoFilter([]);
    setOpenFilter(null);
  }

  return (
    <section className="rounded-lg border border-lavander bg-white p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <h3 className="font-serif text-base text-deep-violet-blue">Monthly values</h3>
          <p className="text-[11px] text-deep-violet-blue/70">
            {rows.length} of {points.length} months shown
          </p>
        </div>
        <div className="flex items-center gap-2">
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
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-lavander">
        <div className={expanded ? '' : 'max-h-[28vh] overflow-y-auto'}>
          <table className="w-full table-fixed text-left text-xs text-deep-violet-blue">
            <colgroup>
              <col className="w-[12%]" />
              {visibleColumns.map((series) => (
                <col key={series.key} className="w-[15%]" />
              ))}
              <col className="w-[28%]" />
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
                    className="px-2.5 py-2 text-[10px] font-semibold uppercase tracking-wide text-deep-violet-blue/60"
                  >
                    {series.label}
                  </th>
                ))}
                <th className="px-1.5 py-2">
                  <HeaderCheckboxFilter
                    id="promo"
                    label="Promo"
                    selected={activePromoFilter}
                    options={promoOptions}
                    openId={openFilter}
                    setOpenId={setOpenFilter}
                    onChange={setPromoFilter}
                  />
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td className="px-2.5 py-3 text-deep-violet-blue/80" colSpan={visibleColumns.length + 2}>
                    No rows match these table filters.
                  </td>
                </tr>
              ) : (
                rows.map((point) => {
                  const highlighted = monthHasPromoType(point, promoType);
                  return (
                    <tr
                      key={point.month_year}
                      className={cn(
                        'border-b border-lavander/80 bg-white hover:bg-cream/50',
                        highlighted && 'bg-lavander/40'
                      )}
                    >
                      <td className="px-2 py-2 font-medium">{point.label}</td>
                      {visibleColumns.map((series) => (
                        <td key={series.key} className="px-1.5 py-2 tabular-nums">
                          {formatTableValue(point[series.key], metric)}
                        </td>
                      ))}
                      <td className="px-2 py-2">
                        {(point.promoTypes?.length
                          ? point.promoTypes
                          : point.promo_type
                            ? [point.promo_type]
                            : []
                        ).length ? (
                          <div className="flex flex-nowrap gap-0.5">
                            {(point.promoTypes?.length
                              ? point.promoTypes
                              : [point.promo_type]
                            ).map((type) => (
                              <span
                                key={type}
                                className={`inline-flex min-w-0 flex-1 basis-0 justify-center truncate rounded-full border px-1 py-1 text-center text-[9px] font-medium tracking-wide ${promoBadgeClass(type)}`}
                                title={
                                  point.promoByType?.[type]?.promotion_mechanic || promoTypeLabel(type)
                                }
                              >
                                {point.promoByType?.[type]?.promotion_mechanic || promoTypeLabel(type)}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-deep-violet-blue/50">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
