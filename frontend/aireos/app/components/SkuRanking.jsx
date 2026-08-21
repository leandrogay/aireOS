'use client';

import { useEffect, useState } from 'react';

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
      ? 'bg-blue-500 text-white border-blue-500'
      : 'bg-white text-gray-600 border-gray-300'
  }`;
}

export default function SkuRanking() {
  const [metric, setMetric] = useState('value');
  const [order, setOrder] = useState('desc');
  const [months, setMonths] = useState([]);
  const [selectedMonth, setSelectedMonth] = useState(null);
  const [weeks, setWeeks] = useState([]);
  const [selectedWeek, setSelectedWeek] = useState('');
  const [weeksLoadedForMonth, setWeeksLoadedForMonth] = useState(null);
  const [skus, setSkus] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // A previously picked week may not exist in a newly selected month, so
  // reset back to "all weeks" whenever the month changes. Adjusting state
  // during render (rather than in an effect) avoids an extra cascading
  // render, per React's guidance on resetting state when a value changes.
  if (selectedMonth !== weeksLoadedForMonth) {
    setWeeksLoadedForMonth(selectedMonth);
    setSelectedWeek('');
  }

  // Load the months that actually have data, then default to the most recent one
  useEffect(() => {
    let cancelled = false;

    async function fetchMonths() {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/sales/months`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Failed to load available months');
        if (cancelled) return;
        setMonths(data.months);
        if (data.months.length > 0) {
          setSelectedMonth(data.months[0].value);
        } else {
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      }
    }

    fetchMonths();
    return () => {
      cancelled = true;
    };
  }, []);

  // Load the weeks within the selected month, and reset back to "all weeks" whenever the month changes (a previously picked week may not exist in the new month).
  useEffect(() => {
    if (!selectedMonth) return undefined;

    let cancelled = false;

    async function fetchWeeks() {
      try {
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/api/sales/weeks?month=${selectedMonth}`
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Failed to load available weeks');
        if (!cancelled) setWeeks(data.weeks);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    }

    fetchWeeks();
    return () => {
      cancelled = true;
    };
  }, [selectedMonth]);

  useEffect(() => {
    if (!selectedMonth) return undefined;

    let cancelled = false;

    async function fetchRanking() {
      setLoading(true);
      setError(null);
      try {
        const weekParam = selectedWeek ? `&week=${selectedWeek}` : '';
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/api/sales/skus?metric=${metric}&order=${order}&month=${selectedMonth}${weekParam}`
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
  }, [metric, order, selectedMonth, selectedWeek]);

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5 mb-8">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <p className="text-sm font-medium text-gray-700">SKU Performance Ranking</p>

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

          <select
            aria-label="Month"
            value={selectedMonth ?? ''}
            onChange={(e) => setSelectedMonth(e.target.value)}
            disabled={months.length === 0}
            className="px-3 py-1 text-xs rounded-full border bg-white text-gray-600 border-gray-300 disabled:opacity-50"
          >
            {months.length === 0 && <option value="">No data available</option>}
            {months.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>

          <select
            aria-label="Week"
            value={selectedWeek}
            onChange={(e) => setSelectedWeek(e.target.value)}
            disabled={weeks.length === 0}
            className="px-3 py-1 text-xs rounded-full border bg-white text-gray-600 border-gray-300 disabled:opacity-50"
          >
            <option value="">All weeks</option>
            {weeks.map((w) => (
              <option key={w.value} value={w.value}>
                {w.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading && <p className="text-gray-500 text-sm">Loading SKU ranking...</p>}
      {error && <p className="text-red-600 text-sm">{error}</p>}

      {!loading && !error && skus.length === 0 && (
        <p className="text-gray-400 text-sm text-center py-6">No SKU data available yet.</p>
      )}

      {!loading && !error && skus.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-t border-gray-100">
              <th className="px-3 py-2">Rank</th>
              <th className="px-3 py-2">SKU</th>
              <th className="px-3 py-2">Product</th>
              <th className="px-3 py-2">Volume</th>
              <th className="px-3 py-2">Value</th>
            </tr>
          </thead>
          <tbody>
            {skus.map((s) => (
              <tr key={s.sku} className="border-t border-gray-100 text-gray-700">
                <td className="px-3 py-2">{s.rank}</td>
                <td className="px-3 py-2">{s.sku}</td>
                <td className="px-3 py-2">{s.product_name}</td>
                <td className="px-3 py-2">{s.volume}</td>
                <td className="px-3 py-2">${s.value.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
