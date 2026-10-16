'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown, ArrowUp } from 'lucide-react';
import TableSkeleton from '@/components/ui/TableSkeleton';
import { changePct, formatChangePct } from '@/app/utils/periodComparison';
import { formatRevenue } from '@/app/utils/trendChart';

const GRAINS = [
  { value: 'customer', label: 'Customers' },
  { value: 'product', label: 'Products' },
];

const headerPillClass =
  'inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide';

function formatVolume(value) {
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function changeColorClass(pct) {
  if (pct > 0) return 'text-green-600';
  if (pct < 0) return 'text-red-600';
  return 'text-deep-violet-blue/60';
}

// Pill in a column header that opens a single-choice menu, same idea as the
// forecast table's month filter. The menu is portalled because the table
// scrolls and would clip a dropdown drawn inside it.
function HeaderMenu({ id, label, active, openId, setOpenId, options, selected, onSelect }) {
  const open = openId === id;
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!open || !buttonRef.current) return undefined;

    const placeMenu = () => {
      const rect = buttonRef.current.getBoundingClientRect();
      setMenuPos({
        top: rect.bottom + 6,
        left: Math.min(rect.left, window.innerWidth - 180),
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
      if (buttonRef.current?.contains(event.target) || menuRef.current?.contains(event.target)) return;
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
        className={`${headerPillClass} ${
          active
            ? 'border-deep-violet-blue bg-deep-violet-blue text-white'
            : 'border-lavander bg-white text-deep-violet-blue hover:bg-cream'
        }`}
      >
        <span className="truncate">{label}</span>
        <span className="text-[8px] leading-none" aria-hidden="true">{open ? '▲' : '▼'}</span>
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          role="listbox"
          style={{ top: menuPos.top, left: menuPos.left }}
          className="fixed z-50 min-w-[11rem] overflow-hidden rounded-xl border border-lavander bg-white py-1 shadow-lg"
        >
          {options.map((option) => {
            const checked = selected === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={checked}
                onClick={() => onSelect(option.value)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] font-normal normal-case tracking-normal text-deep-violet-blue hover:bg-cream"
              >
                <span className="w-3 text-[10px]" aria-hidden="true">{checked ? '✓' : ''}</span>
                {option.label}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}

// Only the column the rows are sorted by shows an arrow. ▼ is highest
// first, ▲ is lowest first. The other column has none, because its numbers
// are not in that order.
function SortHeader({ label, active, order, onClick }) {
  const descending = order !== 'asc';
  const Arrow = descending ? ArrowDown : ArrowUp;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`${headerPillClass} ${
        active
          ? 'border-deep-violet-blue bg-deep-violet-blue text-white'
          : 'border-lavander bg-white text-deep-violet-blue hover:bg-cream'
      }`}
    >
      <span className="truncate">{label}</span>
      {/* The slot stays either way, so the header does not jump when the
          arrow moves to the other column. */}
      <span className="inline-flex size-3 shrink-0 items-center justify-center" aria-hidden="true">
        {active && <Arrow className="size-3" />}
      </span>
      <span className="sr-only">
        {active
          ? descending
            ? ', highest first. Click to sort lowest first.'
            : ', lowest first. Click to sort highest first.'
          : ', not sorting. Click to sort highest first.'}
      </span>
    </button>
  );
}

// One row per customer that sells through the active channel, highest metric
// first unless order is 'asc'. A customer with no sales in the period stays,
// at 0, so the bottom of the list is the quiet one. Rank is the row number
// after that sort.
function rankCustomers(rows, mode, metric, order) {
  const ranked = rows
    .filter((row) => (mode === 'online' ? row.has_online : row.has_offline))
    .map((row) => {
      const channel = row[mode] ?? { revenue: 0, units: 0 };
      return {
        customer: row.customer,
        label: row.label,
        volume: channel.units ?? 0,
        value: channel.revenue ?? 0,
      };
    });
  ranked.sort((a, b) => {
    const diff = order === 'asc' ? a[metric] - b[metric] : b[metric] - a[metric];
    if (diff !== 0) return diff;
    return a.label.localeCompare(b.label);
  });
  return ranked.map((row, index) => ({ ...row, rank: index + 1 }));
}

// Ranks SKUs for the selected period. With a "Compare to" baseline
// (comparisonStart/comparisonEnd), the same ranking is fetched for the
// baseline too and each SKU gets a change column for the chosen metric —
// the ranking endpoint returns every SKU, so matching by code is complete.
export default function SkuRanking({
  dataVersion = 0,
  sku = '',
  mode = 'offline',
  customer = '',
  store = '',
  startDate = '',
  endDate = '',
  comparisonStart = '',
  comparisonEnd = '',
  compareShort = '',
  comparingCustomers = false,
  customers = [],
  customerRows = [],
  customerRowsLoading = false,
  customerRowsError = null,
}) {
  // Customers is the cross-customer default (one total per customer).
  // Products is one row per SKU, summed across whoever is ticked.
  const [rankBy, setRankBy] = useState('customer');
  // Before either header is clicked the rows are already ranked by sales
  // value, highest first, so Value opens with the down arrow and Volume
  // opens with none. Choosing the other column moves the arrow across.
  const [metric, setMetric] = useState('value');
  const [order, setOrder] = useState('desc');
  const [openHeader, setOpenHeader] = useState(null);
  const showCustomers = comparingCustomers && rankBy === 'customer';
  const customerKey = customers.join(',');
  const [skus, setSkus] = useState([]);
  const [baselineBySku, setBaselineBySku] = useState(null);
  const [fetchedKey, setFetchedKey] = useState('');
  const [error, setError] = useState(null);
  const rankingProducts = !showCustomers && (comparingCustomers || Boolean(customer));
  const productRequestKey = JSON.stringify({
    metric,
    order,
    sku,
    mode,
    scope: comparingCustomers ? customerKey : customer,
    store: comparingCustomers ? '' : store,
    startDate,
    endDate,
    comparisonStart,
    comparisonEnd,
  });
  // True from the render the product filters change, so the table doesn't
  // flash the previous customer's SKUs. A dataVersion refresh keeps the key,
  // so the rows stay up while the new ranking arrives.
  const productLoading = rankingProducts && fetchedKey !== productRequestKey;

  useEffect(() => {
    if (!rankingProducts) return undefined;

    let cancelled = false;

    async function fetchRanking() {
      async function fetchSkus(rangeStart, rangeEnd) {
        const params = new URLSearchParams({ metric, order });
        if (comparingCustomers) params.set('customers', customerKey);
        else params.set('customer', customer);
        if (sku) params.set('sku', sku);
        if (mode) params.set('mode', mode);
        if (!comparingCustomers && store) params.set('store', store);
        if (rangeStart) params.set('start_date', rangeStart);
        if (rangeEnd) params.set('end_date', rangeEnd);
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/api/sales/skus?${params.toString()}`
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Failed to load SKU ranking');
        return data.skus;
      }

      try {
        const hasComparison = Boolean(comparisonStart && comparisonEnd);
        const [current, baseline] = await Promise.all([
          fetchSkus(startDate, endDate),
          hasComparison ? fetchSkus(comparisonStart, comparisonEnd) : null,
        ]);
        if (cancelled) return;
        setSkus(current);
        setBaselineBySku(baseline ? new Map(baseline.map((s) => [s.sku, s])) : null);
        setFetchedKey(productRequestKey);
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
          setFetchedKey(productRequestKey);
        }
      }
    }

    fetchRanking();
    return () => {
      cancelled = true;
    };
  }, [rankingProducts, productRequestKey, dataVersion, metric, order, sku, mode, customer, customerKey, comparingCustomers, store, startDate, endDate, comparisonStart, comparisonEnd]);

  // While loading, the Change column follows the comparison being fetched,
  // not the previous result, so the skeleton has the columns the data will.
  const showChange = !showCustomers && (productLoading ? Boolean(comparisonStart && comparisonEnd) : baselineBySku !== null);
  const customersRanked = showCustomers
    ? rankCustomers(customerRows, mode, metric, order)
    : [];
  const tableLoading = showCustomers ? customerRowsLoading : productLoading;
  const tableError = showCustomers ? customerRowsError : error;
  const channelLabel = mode === 'online' ? 'Online' : 'Offline';

  const headerClass = 'px-2.5 py-2 text-[10px] font-semibold uppercase tracking-wide text-deep-violet-blue/60';
  const cellClass = 'px-2.5 py-2';

  function clickSort(columnMetric) {
    if (metric !== columnMetric) {
      setMetric(columnMetric);
      setOrder('desc');
      return;
    }
    setOrder(order === 'desc' ? 'asc' : 'desc');
  }

  return (
    <section className="bg-white rounded-lg border border-lavander shadow-sm p-3">
      <div className="mb-2">
        <h3 className="font-serif text-base text-deep-violet-blue">
          {showCustomers ? 'Customer Sales' : 'SKU Performance Ranking'}{' '}
          <span className="font-sans text-sm font-normal text-deep-violet-blue/50">
            ({channelLabel})
          </span>
        </h3>
        {comparingCustomers && (
          <p className="text-[11px] text-deep-violet-blue/70">
            {showCustomers
              ? "Showing each customer's total for the selected period."
              : 'Showing each product, summed across the selected customers.'}
          </p>
        )}
      </div>

      {tableError && <p className="mb-2 text-sm text-red-600">{tableError}</p>}

      <div className="w-full overflow-x-auto rounded-md border border-lavander">
          <table className="w-full table-fixed text-left text-xs text-deep-violet-blue" aria-busy={tableLoading}>
            <colgroup>
              <col className="w-[8%]" />
              <col className={showChange ? 'w-[36%]' : 'w-[44%]'} />
              <col className={showChange ? 'w-[18%]' : 'w-[24%]'} />
              <col className={showChange ? 'w-[20%]' : 'w-[24%]'} />
              {showChange && <col className="w-[18%]" />}
            </colgroup>
            <thead className="bg-cream">
              <tr className="border-b border-lavander">
                <th className={headerClass}>Rank</th>
                {comparingCustomers ? (
                  <th className="px-1.5 py-2">
                    <HeaderMenu
                      id="grain"
                      label={showCustomers ? 'Customer' : 'Product'}
                      active={false}
                      openId={openHeader}
                      setOpenId={setOpenHeader}
                      options={GRAINS}
                      selected={rankBy}
                      onSelect={(value) => {
                        setRankBy(value);
                        setOpenHeader(null);
                      }}
                    />
                  </th>
                ) : (
                  <th className={headerClass}>Product</th>
                )}
                <th className="px-1.5 py-2" aria-sort={metric === 'volume' ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  <SortHeader
                    label="Volume"
                    active={metric === 'volume'}
                    order={order}
                    onClick={() => clickSort('volume')}
                  />
                </th>
                <th className="px-1.5 py-2" aria-sort={metric === 'value' ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  <SortHeader
                    label="Value"
                    active={metric === 'value'}
                    order={order}
                    onClick={() => clickSort('value')}
                  />
                </th>
                {showChange && <th className={headerClass}>Change {compareShort}</th>}
              </tr>
            </thead>
            <tbody>
              {tableLoading && (
                <TableSkeleton
                  columns={showChange ? 5 : 4}
                  rows={5}
                  className="h-auto border-lavander/80"
                  cellClassName={cellClass}
                />
              )}
              {!tableLoading && !tableError && (showCustomers ? customersRanked.length === 0 : skus.length === 0) && (
                <tr>
                  <td className="px-2.5 py-6 text-center text-deep-violet-blue/50" colSpan={showChange ? 5 : 4}>
                    {showCustomers
                      ? 'No customer sales for this channel in the selected period.'
                      : comparingCustomers
                        ? 'No product sales for this channel in the selected period.'
                        : 'No SKU data available yet.'}
                  </td>
                </tr>
              )}
              {!tableLoading && !tableError && showCustomers && customersRanked.map((row) => (
                <tr key={row.customer} className="border-b border-lavander/80 bg-white last:border-b-0 hover:bg-cream/50">
                  <td className={`${cellClass} tabular-nums`}>{row.rank}</td>
                  <td className={`${cellClass} truncate font-medium`}>{row.label}</td>
                  <td className={`${cellClass} tabular-nums`}>{formatVolume(row.volume)}</td>
                  <td className={`${cellClass} tabular-nums`}>{formatRevenue(row.value)}</td>
                </tr>
              ))}
              {!tableLoading && !tableError && !showCustomers && skus.map((s) => (
                <tr key={s.sku} className="border-b border-lavander/80 bg-white last:border-b-0 hover:bg-cream/50">
                  <td className={`${cellClass} tabular-nums`}>{s.rank}</td>
                  <td className={`${cellClass} truncate font-medium`} title={s.product_name}>{s.product_name}</td>
                  <td className={`${cellClass} tabular-nums`}>{formatVolume(s.volume)}</td>
                  <td className={`${cellClass} tabular-nums`}>{formatRevenue(s.value)}</td>
                  {baselineBySku && (
                    <SkuChange current={s[metric]} baseline={baselineBySku.get(s.sku)?.[metric] ?? 0} />
                  )}
                </tr>
              ))}
            </tbody>
          </table>
      </div>
    </section>
  );
}

// Change in the ranking's metric (value or volume) vs the baseline. A SKU
// with no baseline sales shows "New" rather than an infinite percentage.
function SkuChange({ current, baseline }) {
  if (!baseline) {
    return <td className="px-2.5 py-2 text-deep-violet-blue/60">{current ? 'New' : '—'}</td>;
  }
  const pct = changePct(current, baseline);
  return (
    <td className={`px-2.5 py-2 font-medium tabular-nums ${changeColorClass(pct)}`}>
      {pct > 0 ? '▲ ' : pct < 0 ? '▼ ' : ''}
      {formatChangePct(pct)}
    </td>
  );
}
