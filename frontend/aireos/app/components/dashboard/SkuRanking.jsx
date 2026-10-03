'use client';

import { useEffect, useRef, useState } from 'react';
import TableSkeleton from '@/components/ui/TableSkeleton';
import { changePct, formatChangePct } from '@/app/utils/periodComparison';

const METRICS = [
  { value: 'value', label: 'Sales Value' },
  { value: 'volume', label: 'Sales Volume' },
];

const ORDER_OPTIONS = [
  { value: 'desc', label: 'Highest first' },
  { value: 'asc', label: 'Lowest first' },
];

function toggleButtonClass(isActive) {
  return `px-3 py-1 text-xs rounded-full border transition-colors ${
    isActive
      ? 'bg-deep-violet-blue text-white border-deep-violet-blue'
      : 'bg-white text-deep-violet-blue border-violet hover:bg-lavander'
  }`;
}

function changeColorClass(pct) {
  if (pct > 0) return 'text-green-600';
  if (pct < 0) return 'text-red-600';
  return 'text-deep-violet-blue/60';
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
}) {
  const [metric, setMetric] = useState('value');
  const [order, setOrder] = useState('desc');
  const [skus, setSkus] = useState([]);
  const [baselineBySku, setBaselineBySku] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const dataVersionRef = useRef(dataVersion);

  useEffect(() => {
    if (!customer) return undefined;

    let cancelled = false;
    const silentRefresh = dataVersionRef.current !== dataVersion;
    dataVersionRef.current = dataVersion;

    async function fetchRanking() {
      if (!silentRefresh) {
        setLoading(true);
      }
      setError(null);
      async function fetchSkus(rangeStart, rangeEnd) {
        const params = new URLSearchParams({ metric, order, customer });
        if (sku) params.set('sku', sku);
        if (mode) params.set('mode', mode);
        if (store) params.set('store', store);
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
        if (!cancelled) {
          setSkus(current);
          setBaselineBySku(baseline ? new Map(baseline.map((s) => [s.sku, s])) : null);
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchRanking();
    return () => {
      cancelled = true;
    };
  }, [metric, order, dataVersion, sku, mode, customer, store, startDate, endDate, comparisonStart, comparisonEnd]);

  // While loading, the Change column follows the comparison being fetched,
  // not the previous result, so the skeleton has the columns the data will.
  const showChange = loading ? Boolean(comparisonStart && comparisonEnd) : baselineBySku !== null;

  return (
    <div className="bg-white rounded-lg border border-lavander shadow-sm p-3">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
        <p className="text-sm font-medium text-deep-violet-blue">
          SKU Performance Ranking{' '}
          <span className="font-normal text-deep-violet-blue/50">
            ({mode === 'online' ? 'Online' : 'Offline'})
          </span>
        </p>

        <div className="flex flex-wrap gap-2">
          {METRICS.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => setMetric(m.value)}
              className={toggleButtonClass(metric === m.value)}
            >
              {m.label}
            </button>
          ))}

          {ORDER_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => setOrder(o.value)}
              className={toggleButtonClass(order === o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      {!loading && !error && skus.length === 0 && (
        <p className="text-deep-violet-blue/50 text-sm text-center py-6">No SKU data available yet.</p>
      )}

      {(loading || (!error && skus.length > 0)) && (
        <table className="w-full text-sm" aria-busy={loading}>
          <thead>
            <tr className="text-left text-deep-violet-blue/70 border-t border-lavander">
              <th className="px-3 py-1">Rank</th>
              <th className="px-3 py-1">Product</th>
              <th className="px-3 py-1">Volume</th>
              <th className="px-3 py-1">Value</th>
              {showChange && <th className="px-3 py-1">Change {compareShort}</th>}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <TableSkeleton
                columns={showChange ? 5 : 4}
                rows={5}
                className="h-7 border-b-0 border-t border-lavander"
                cellClassName="px-3 py-1"
              />
            )}
            {!loading && skus.map((s) => (
              <tr key={s.sku} className="border-t border-lavander text-deep-violet-blue">
                <td className="px-3 py-1">{s.rank}</td>
                <td className="px-3 py-1">{s.product_name}</td>
                <td className="px-3 py-1">{s.volume}</td>
                <td className="px-3 py-1">${s.value.toLocaleString()}</td>
                {baselineBySku && (
                  <SkuChange current={s[metric]} baseline={baselineBySku.get(s.sku)?.[metric] ?? 0} />
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// Change in the ranking's metric (value or volume) vs the baseline. A SKU
// with no baseline sales shows "New" rather than an infinite percentage.
function SkuChange({ current, baseline }) {
  if (!baseline) {
    return <td className="px-3 py-1 text-deep-violet-blue/60">{current ? 'New' : '—'}</td>;
  }
  const pct = changePct(current, baseline);
  return (
    <td className={`px-3 py-1 font-medium ${changeColorClass(pct)}`}>
      {pct > 0 ? '▲ ' : pct < 0 ? '▼ ' : ''}
      {formatChangePct(pct)}
    </td>
  );
}
