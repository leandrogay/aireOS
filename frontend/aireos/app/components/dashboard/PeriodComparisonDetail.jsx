'use client';

import { formatDateRange } from '@/lib/formatDateRange';

function computeChangePct(current, previous) {
  if (!previous) return null;
  return ((current - previous) / previous) * 100;
}

// Current-vs-previous revenue/units breakdown, plus the % change (with a
// green/red arrow), rendered below the trend chart. The comparison-type
// toggle and "vs." previous-period fields live in DashboardFilters instead
// — this is just the resulting numbers, driven by the shared
// usePeriodComparison() state (see page.js).
export default function PeriodComparisonDetail({ result, loading = false, error = null, active = true }) {
  const currentLabel = formatDateRange(result?.current?.start, result?.current?.end) ?? '—';
  const previousLabel = formatDateRange(result?.previous?.start, result?.previous?.end) ?? '—';
  const available = result?.previous?.available;
  const pct = available ? computeChangePct(result.current.revenue, result.previous.revenue) : null;
  const isPositive = pct !== null && pct > 0;
  const isNegative = pct !== null && pct < 0;
  const changeColorClass = isPositive ? 'text-green-600' : isNegative ? 'text-red-600' : 'text-deep-violet-blue';
  const changeText = pct === null ? '—' : `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;

  return (
    <div className="bg-white rounded-lg border border-lavander shadow-sm p-3 h-full">
      <p className="text-sm font-medium text-deep-violet-blue mb-2">Period Comparison</p>

      {!active && (
        <p className="text-deep-violet-blue/50 text-sm">
          Pick WoW/MoM/YoY or a date range in the Filter panel to compare periods.
        </p>
      )}

      {active && loading && <p className="text-deep-violet-blue/70 text-sm">Loading period comparison...</p>}
      {active && error && <p className="text-red-600 text-sm">{error}</p>}

      {active && !loading && !error && result && (
        <div className="flex flex-col gap-1 sm:flex-row sm:gap-2">
          <div className="sm:flex-[2]">
            <p className="text-xs text-deep-violet-blue/60">{currentLabel}</p>
            <p className="text-base font-semibold text-deep-violet-blue">${result.current.revenue.toLocaleString()}</p>
            <p className="text-xs text-deep-violet-blue/60">{result.current.units.toLocaleString()} units</p>
          </div>
          <div className="sm:flex-[2]">
            <p className="text-xs text-deep-violet-blue/60">{previousLabel}</p>
            {result.previous.available ? (
              <>
                <p className="text-base font-semibold text-deep-violet-blue">${result.previous.revenue.toLocaleString()}</p>
                <p className="text-xs text-deep-violet-blue/60">{result.previous.units.toLocaleString()} units</p>
              </>
            ) : (
              <p className="text-sm text-deep-violet-blue/50">No data available</p>
            )}
          </div>
          <div className="sm:flex-1">
            <p className="text-xs text-deep-violet-blue/60">Change</p>
            <p className={`flex items-center gap-1 text-base font-semibold ${changeColorClass}`}>
              {isPositive && <span aria-hidden="true">▲</span>}
              {isNegative && <span aria-hidden="true">▼</span>}
              {changeText}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
