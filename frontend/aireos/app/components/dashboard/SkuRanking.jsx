'use client';

import { useEffect, useState } from 'react';
import MobileRecordCard from '@/components/ui/MobileRecordCard';
import RecordCardList from '@/components/ui/RecordCardList';
import SegmentedControl from '@/components/ui/SegmentedControl';
import SelectDropdown from '@/components/ui/SelectDropdown';
import TableCard from '@/components/ui/TableCard';
import TableCardHeader from '@/components/ui/TableCardHeader';
import TableGrid from '@/components/ui/TableGrid';
import TableRow from '@/components/ui/TableRow';
import { cn } from '@/lib/utils';
import { changePct, formatChangePct } from '@/app/utils/periodComparison';
import { rankCustomers, rankSkus } from '@/app/utils/salesRanking';
import { formatRevenue } from '@/app/utils/trendChart';
import EstMark from '@/components/dashboard/EstMark';

const GRAINS = [
  { value: 'customer', label: 'Customers' },
  { value: 'product', label: 'Products' },
];

const CELL_CLASS = 'px-4 py-2.5';
// Volume, value and change are right-aligned so their digits line up.
const NUMBER_CELL_CLASS = 'px-4 py-2.5 text-right tabular-nums';
const ROW_CLASS = 'h-12 border-b border-lavander/80';

function formatVolume(value) {
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function changeColorClass(pct) {
  if (pct > 0) return 'text-green-600';
  if (pct < 0) return 'text-red-600';
  return 'text-deep-violet-blue/60';
}

/**
 * The ranking's columns (ui/TableGrid). Volume and Value sort the rows
 * (`metric`); Change only shows with a "Compare to" baseline.
 *
 * @param {{ showCustomers: boolean, showChange: boolean, compareShort: string }} options
 * @returns {object[]}
 */
function rankingColumns({ showCustomers, showChange, compareShort }) {
  return [
    { key: 'rank', label: 'Rank', width: '4.5rem' },
    { key: 'name', label: showCustomers ? 'Customer' : 'Product' },
    { key: 'volume', label: 'Volume', width: '7rem', align: 'right', sortField: 'volume' },
    { key: 'value', label: 'Value', width: '8.5rem', align: 'right', sortField: 'value' },
    showChange && { key: 'change', label: `Change ${compareShort}`, width: '8rem', align: 'right' },
  ].filter(Boolean);
}

// A customer with nothing loaded for the period, in place of a 0 that would
// read as no sales.
const NO_DATA = <span className="text-deep-violet-blue/50">No data</span>;

// Ranks SKUs for the selected period, sorted on the client
// (utils/salesRanking.js) so a new sort moves the rows rather than reloading
// them. With a "Compare to" baseline
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
  customerColorOrder = [],
  // The page is still loading (page.js pageStatus): placeholder rows, not
  // "No SKU data available yet."
  loading = false,
}) {
  // Customers is the cross-customer default (one total per customer).
  // Products is one row per SKU, summed across whoever is ticked.
  const [rankBy, setRankBy] = useState('customer');
  // Before either header is clicked the rows are already ranked by sales
  // value, highest first, so Value opens with the up arrow (ui/SortHeader)
  // and Volume opens with none. Choosing the other column moves the arrow across.
  const [metric, setMetric] = useState('value');
  const [order, setOrder] = useState('desc');
  const showCustomers = comparingCustomers && rankBy === 'customer';
  const customerKey = customers.join(',');
  const [skus, setSkus] = useState([]);
  const [baselineBySku, setBaselineBySku] = useState(null);
  const [fetchedKey, setFetchedKey] = useState('');
  const [error, setError] = useState(null);
  const rankingProducts = !showCustomers && (comparingCustomers || Boolean(customer));
  // No customer ticked: an empty table that says so. The last ranking stays
  // in state (the fetch is skipped), so it is hidden rather than shown stale.
  const noCustomers = customers.length === 0;
  const shownSkus = noCustomers ? [] : rankSkus(skus, metric, order);
  // The sort (metric, order) is not part of it: the ranking holds every SKU
  // either way, so sorting never fetches.
  const productRequestKey = JSON.stringify({
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
        const params = new URLSearchParams();
        if (comparingCustomers) params.set('customers', customerKey);
        else params.set('customer', customer);
        if (sku) params.set('sku', sku);
        if (mode) params.set('mode', mode);
        if (!comparingCustomers && store) params.set('store', store);
        if (rangeStart) params.set('start_date', rangeStart);
        if (rangeEnd) params.set('end_date', rangeEnd);
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/api/sales/skus?${params.toString()}`,
          { credentials: 'include' },
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
  }, [rankingProducts, productRequestKey, dataVersion, sku, mode, customer, customerKey, comparingCustomers, store, startDate, endDate, comparisonStart, comparisonEnd]);

  // While loading, the Change column follows the comparison being fetched,
  // not the previous result, so the skeleton has the columns the data will.
  const showChange = !noCustomers && !showCustomers && (productLoading ? Boolean(comparisonStart && comparisonEnd) : baselineBySku !== null);
  const customersRanked = showCustomers
    ? rankCustomers(customerRows, mode, metric, order, customerColorOrder)
    : [];
  // `loading` (the page's first load) wins over an empty selection: until the
  // customer list loads, no customer is ticked yet, and the table should show
  // its skeleton rather than "Select at least one customer".
  const tableLoading = loading || (!noCustomers && (showCustomers ? customerRowsLoading : productLoading));
  const tableError = noCustomers ? null : (showCustomers ? customerRowsError : error);
  const channelLabel = mode === 'online' ? 'Online' : 'Offline';

  // Pressing the sorted column flips its order; the other column starts
  // highest first.
  function clickSort(columnMetric) {
    if (metric !== columnMetric) {
      setMetric(columnMetric);
      setOrder('desc');
      return;
    }
    setOrder(order === 'desc' ? 'asc' : 'desc');
  }

  const mobileSort = `${metric}-${order}`;
  const mobileSortOptions = [
    { value: 'value-desc', label: 'Value: highest first' },
    { value: 'value-asc', label: 'Value: lowest first' },
    { value: 'volume-desc', label: 'Volume: highest first' },
    { value: 'volume-asc', label: 'Volume: lowest first' },
  ];

  function changeMobileSort(value) {
    const [nextMetric, nextOrder] = value.split('-');
    setMetric(nextMetric);
    setOrder(nextOrder);
  }

  const shownRows = showCustomers ? customersRanked : shownSkus;
  const showRows = !tableLoading && !tableError;
  const emptyMessage = noCustomers
    ? 'Select at least one customer.'
    : showCustomers
      ? 'No customer sales for this channel in the selected period.'
      : comparingCustomers
        ? 'No product sales for this channel in the selected period.'
        : 'No SKU data available yet.';
  const emptyState = showRows && shownRows.length === 0 ? emptyMessage : null;

  return (
    <TableCard
      variant="glass"
      label={`${showCustomers ? 'Customer' : 'Product'} sales ranking`}
      header={(
        <TableCardHeader
          title={<>
            {showCustomers ? 'Customer Sales' : 'SKU Performance Ranking'}{' '}
            <span className="font-sans text-sm font-normal text-deep-violet-blue/50">
              ({channelLabel})
            </span>
          </>}
          detail={comparingCustomers
            ? (showCustomers
              ? "Showing each customer's total for the selected period."
              : 'Showing each product, summed across the selected customers.')
            : null}
          actions={comparingCustomers && (
            <SegmentedControl
              value={rankBy}
              onChange={setRankBy}
              options={GRAINS}
              ariaLabel="Rank customers or products"
            />
          )}
        />
      )}
    >
      {tableError && <p className="px-4 pb-2 text-sm text-red-600">{tableError}</p>}

      {/* Phones: no column headers to press, so the sort is a dropdown. */}
      <div className="px-4 pb-3 sm:hidden">
        <p className="mb-1 text-[11px] font-medium text-deep-violet-blue/65">Sort by</p>
        <SelectDropdown
          value={mobileSort}
          onChange={changeMobileSort}
          options={mobileSortOptions}
          ariaLabel="Sort sales ranking"
          look="filter"
          className="min-w-0"
        />
      </div>

      <div className="border-t border-lavander bg-cream/25 p-3 sm:hidden">
        {tableLoading ? (
          <div className="grid gap-2" aria-label="Loading sales ranking">
            {Array.from({ length: 3 }, (_, index) => <div key={index} className="h-24 animate-pulse rounded-lg border border-lavander bg-white" />)}
          </div>
        ) : emptyState ? (
          <p className="rounded-lg border border-lavander bg-white p-6 text-center text-sm text-deep-violet-blue/70">{emptyState}</p>
        ) : showRows && (
          <RecordCardList>
            {shownRows.map((row) => (
              <MobileRecordCard
                key={showCustomers ? row.customer : row.sku}
                title={showCustomers ? row.label : row.product_name}
                subtitle={`Rank ${row.rank}`}
                fields={[
                  { label: 'Volume', value: row.hasData === false ? NO_DATA : formatVolume(row.volume) },
                  { label: 'Value', value: row.hasData === false ? NO_DATA : formatRevenue(row.value) },
                  ...(!showCustomers && baselineBySku
                    ? [{ label: `Change ${compareShort}`, value: <ChangeText current={row[metric]} baseline={baselineBySku.get(row.sku)?.[metric] ?? 0} /> }]
                    : []),
                ]}
              />
            ))}
          </RecordCardList>
        )}
      </div>

      <div className="hidden sm:block">
        <TableGrid
          columns={rankingColumns({ showCustomers, showChange, compareShort })}
          minWidth="30rem"
          sort={{ field: metric, direction: order }}
          onSort={clickSort}
          isLoading={tableLoading}
          skeletonRows={5}
          emptyState={emptyState}
        >
          {showRows && showCustomers && customersRanked.map((row) => (
            <TableRow key={row.customer} className={ROW_CLASS}>
              <td className={NUMBER_CELL_CLASS}>{row.rank}</td>
              <td className={CELL_CLASS} title={row.label}>
                <NameWithEst name={row.label} value={row.value} estimated={row.estimatedValue} color={row.color} />
              </td>
              <td className={NUMBER_CELL_CLASS}>{row.hasData ? formatVolume(row.volume) : NO_DATA}</td>
              <td className={NUMBER_CELL_CLASS}>{row.hasData ? formatRevenue(row.value) : NO_DATA}</td>
            </TableRow>
          ))}
          {showRows && !showCustomers && shownSkus.map((s) => (
            <TableRow key={s.sku} className={ROW_CLASS}>
              <td className={NUMBER_CELL_CLASS}>{s.rank}</td>
              <td className={CELL_CLASS} title={s.product_name}>
                <NameWithEst name={s.product_name} value={s.value} estimated={s.estimated_value} />
              </td>
              <td className={NUMBER_CELL_CLASS}>{formatVolume(s.volume)}</td>
              <td className={NUMBER_CELL_CLASS}>{formatRevenue(s.value)}</td>
              {baselineBySku && (
                <td className={NUMBER_CELL_CLASS}>
                  <ChangeText current={s[metric]} baseline={baselineBySku.get(s.sku)?.[metric] ?? 0} />
                </td>
              )}
            </TableRow>
          ))}
        </TableGrid>
      </div>
    </TableCard>
  );
}

// A row's name, with the est. tag a little after it
// when part of its revenue is estimated (backend estimated_value /
// estimated_revenue). A long name truncates; est. always stays in view. A
// customer row leads with its chart colour (`color`).
function NameWithEst({ name, value, estimated, color = null }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      {color && <span className="-mr-1 size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />}
      <span className="truncate font-medium">{name}</span>
      <EstMark estimated={estimated} total={value} />
    </span>
  );
}

// Change in the ranking's metric (value or volume) vs the baseline. A SKU
// with no baseline sales shows "New" rather than an infinite percentage.
function ChangeText({ current, baseline }) {
  if (!baseline) {
    return <span className="text-deep-violet-blue/60">{current ? 'New' : '—'}</span>;
  }
  const pct = changePct(current, baseline);
  return (
    <span className={cn('font-medium', changeColorClass(pct))}>
      {pct > 0 ? '▲ ' : pct < 0 ? '▼ ' : ''}
      {formatChangePct(pct)}
    </span>
  );
}
