'use client';

import { useEffect, useRef, useState } from 'react';

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

export default function SkuRanking({
  dataVersion = 0,
  sku = '',
  mode = 'offline',
  customer = '',
  store = '',
  startDate = '',
  endDate = '',
}) {
  const [metric, setMetric] = useState('value');
  const [order, setOrder] = useState('desc');
  const [skus, setSkus] = useState([]);
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
      try {
        const params = new URLSearchParams({ metric, order, customer });
        if (sku) params.set('sku', sku);
        if (mode) params.set('mode', mode);
        if (store) params.set('store', store);
        if (startDate) params.set('start_date', startDate);
        if (endDate) params.set('end_date', endDate);
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/api/sales/skus?${params.toString()}`
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Failed to load SKU ranking');
        if (!cancelled) setSkus(data.skus);
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
  }, [metric, order, dataVersion, sku, mode, customer, store, startDate, endDate]);

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

      {loading && <p className="text-deep-violet-blue/70 text-sm">Loading SKU ranking...</p>}
      {error && <p className="text-red-600 text-sm">{error}</p>}

      {!loading && !error && skus.length === 0 && (
        <p className="text-deep-violet-blue/50 text-sm text-center py-6">No SKU data available yet.</p>
      )}

      {!loading && !error && skus.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-deep-violet-blue/70 border-t border-lavander">
              <th className="px-3 py-1">Rank</th>
              <th className="px-3 py-1">Product</th>
              <th className="px-3 py-1">Volume</th>
              <th className="px-3 py-1">Value</th>
            </tr>
          </thead>
          <tbody>
            {skus.map((s) => (
              <tr key={s.sku} className="border-t border-lavander text-deep-violet-blue">
                <td className="px-3 py-1">{s.rank}</td>
                <td className="px-3 py-1">{s.product_name}</td>
                <td className="px-3 py-1">{s.volume}</td>
                <td className="px-3 py-1">${s.value.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
