'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { cn } from '@/lib/utils';
import { promoTypeLabel } from '@/app/utils/promotionForm';
import {
  FORECAST_SERIES,
  monthHasPromoType,
  promoBadgeClass,
  uniqueMonthOptions,
  uniquePromoOptions,
} from '@/app/utils/forecastView';

const pillClass =
  'inline-flex w-max max-w-[11rem] items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide';

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

function toggleValue(selected, value) {
  return selected.includes(value)
    ? selected.filter((item) => item !== value)
    : [...selected, value];
}

function HeaderCheckboxFilter({ id, label, selected, options, openId, setOpenId, onChange }) {
  const open = openId === id;
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0, maxHeight: 256 });
  const isActive = selected.length > 0;

  useEffect(() => {
    if (!open || !buttonRef.current) return undefined;

    const placeMenu = () => {
      const rect = buttonRef.current.getBoundingClientRect();
      const maxHeight = 256;
      const spaceBelow = window.innerHeight - rect.bottom - 12;
      const spaceAbove = rect.top - 12;
      const openUp = spaceBelow < 160 && spaceAbove > spaceBelow;
      const height = Math.max(120, Math.min(maxHeight, openUp ? spaceAbove : spaceBelow));

      setMenuPos({
        top: openUp ? rect.top - height - 6 : rect.bottom + 6,
        left: Math.min(rect.left, window.innerWidth - 220),
        maxHeight: height,
      });
    };

    placeMenu();
    window.addEventListener('resize', placeMenu);
    window.addEventListener('scroll', placeMenu, true);
    return () => {
      window.removeEventListener('resize', placeMenu);
      window.removeEventListener('scroll', placeMenu, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event) => {
      if (buttonRef.current?.contains(event.target) || menuRef.current?.contains(event.target)) {
        return;
      }
      setOpenId(null);
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open, setOpenId]);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpenId(open ? null : id)}
        className={`${pillClass} ${
          isActive
            ? 'border-deep-violet-blue bg-deep-violet-blue text-white'
            : 'border-lavander bg-white text-deep-violet-blue hover:bg-cream'
        }`}
      >
        <span className="truncate">{label}</span>
        {isActive ? <span className="text-[9px] font-bold">{selected.length}</span> : null}
        <span className="text-[8px] leading-none" aria-hidden="true">
          {open ? '▲' : '▼'}
        </span>
      </button>
      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            aria-multiselectable="true"
            style={{
              top: menuPos.top,
              left: menuPos.left,
              maxHeight: menuPos.maxHeight,
            }}
            className="fixed z-50 flex min-w-[12rem] flex-col overflow-hidden rounded-xl border border-lavander bg-white shadow-lg"
          >
            {isActive ? (
              <button
                type="button"
                onClick={() => onChange([])}
                className="shrink-0 border-b border-lavander bg-white px-3 py-1.5 text-left text-[11px] font-medium text-deep-violet-blue hover:bg-cream"
              >
                Clear
              </button>
            ) : null}
            <div className="min-h-0 flex-1 overflow-y-auto py-1">
              {options.length === 0 ? (
                <p className="px-3 py-2 text-[11px] font-normal normal-case tracking-normal text-deep-violet-blue/70">
                  No values in the current data.
                </p>
              ) : (
                options.map((option) => {
                  const checked = selected.includes(option.value);
                  return (
                    <label
                      key={option.value}
                      className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[11px] font-normal normal-case tracking-normal text-deep-violet-blue hover:bg-cream"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => onChange(toggleValue(selected, option.value))}
                        className="size-3.5 accent-deep-violet-blue"
                      />
                      {option.label}
                    </label>
                  );
                })
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

export default function ForecastTable({ points, metric, promoType, visibleSeries }) {
  const [monthFilter, setMonthFilter] = useState([]);
  const [promoFilter, setPromoFilter] = useState([]);
  const [openFilter, setOpenFilter] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const hasTableFilters = monthFilter.length > 0 || promoFilter.length > 0;
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

  useEffect(() => {
    const validMonths = new Set(monthOptions.map((option) => option.value));
    setMonthFilter((current) => current.filter((value) => validMonths.has(value)));
  }, [monthOptions]);

  useEffect(() => {
    const validPromos = new Set(promoOptions.map((option) => option.value));
    setPromoFilter((current) => current.filter((value) => validPromos.has(value)));
  }, [promoOptions]);

  const rows = useMemo(
    () =>
      points.filter((point) => {
        if (monthFilter.length && !monthFilter.includes(point.month_year)) return false;
        if (promoFilter.length && !promoFilter.some((type) => monthHasPromoType(point, type))) {
          return false;
        }
        return true;
      }),
    [points, monthFilter, promoFilter]
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
                    selected={monthFilter}
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
                    selected={promoFilter}
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
