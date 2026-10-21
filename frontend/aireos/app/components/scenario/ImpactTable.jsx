'use client';

import { retailerLabel } from '@/app/utils/retailerLabel';
import { monthSpanLabel } from '@/app/utils/scenarioPitch';

const headClass =
  'whitespace-nowrap border-b border-[#C5CBE0] bg-cream px-2 py-1.5 text-right text-[10px] font-bold uppercase tracking-wide text-deep-violet-blue first:text-left';
const cellClass = 'border-b border-lavander/70 px-2 py-1.5 text-right align-top tabular-nums';

/**
 * Before / after / uplift for each switched-on item, building blocks and
 * draft promotions alike (blueprint Part 2.3). Each row is measured on the
 * item's own customer and SKU, so rows don't move with the chart filters,
 * except items outside the fetched rows, which show "—".
 *
 * @param {{
 *   rows: object[],
 *   metric: 'units' | 'revenue',
 *   format: (value: number) => string,
 * }} props rows from scenarioPitch.impactRows
 */
export default function ImpactTable({ rows, metric, format }) {
  const before = (totals) => (metric === 'revenue' ? totals.baseRevenue : totals.baseUnits);
  const uplift = (totals) => (metric === 'revenue' ? totals.deltaRevenue : totals.deltaUnits);
  const inView = rows.filter((row) => row.totals);
  const totalBefore = inView.reduce((sum, row) => sum + before(row.totals), 0);
  const totalUplift = inView.reduce((sum, row) => sum + uplift(row.totals), 0);

  return (
    <div className="overflow-x-auto rounded-md border border-lavander">
      <table className="w-full border-separate border-spacing-0 text-xs text-deep-violet-blue">
        <thead>
          <tr>
            <th className={headClass}>Item</th>
            <th className={headClass}>Source</th>
            <th className={headClass}>Explanation</th>
            <th className={headClass}>Months</th>
            <th className={headClass}>Forecast before</th>
            <th className={headClass}>Forecast after</th>
            <th className={headClass}>Uplift</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="bg-white">
              <td className={`${cellClass} text-left`}>
                <span className="block font-medium">{row.title}</span>
                <span className="block text-[11px] text-deep-violet-blue/55">
                  {retailerLabel(row.customer)} · {row.sku || 'All SKUs'}
                  {row.totals ? '' : ' · outside chart filters'}
                </span>
              </td>
              <td className={`${cellClass} text-left`}>{row.sourceLabel}</td>
              <td className={`${cellClass} min-w-48 max-w-72 whitespace-normal text-left text-deep-violet-blue/75`}>
                {row.explanation || <span className="text-deep-violet-blue/40">—</span>}
              </td>
              <td className={`${cellClass} whitespace-nowrap`}>
                {monthSpanLabel([row.startMonth, row.endMonth].filter(Boolean))}
              </td>
              <td className={cellClass}>{row.totals ? format(before(row.totals)) : '—'}</td>
              <td className={cellClass}>
                {row.totals ? format(before(row.totals) + uplift(row.totals)) : '—'}
              </td>
              <td className={`${cellClass} whitespace-nowrap`}>
                {row.totals ? (
                  <>
                    <span className="font-semibold text-scenario">+{format(uplift(row.totals))}</span>
                    <span className="ml-1 text-[10px] text-deep-violet-blue/50">{row.upliftLabel}</span>
                  </>
                ) : (
                  '—'
                )}
              </td>
            </tr>
          ))}
          {rows.length > 1 ? (
            <tr className="bg-lavander/60 font-semibold">
              <td className={`${cellClass} text-left`} colSpan={4}>All items</td>
              <td className={cellClass}>{format(totalBefore)}</td>
              <td className={cellClass}>{format(totalBefore + totalUplift)}</td>
              <td className={cellClass}>+{format(totalUplift)}</td>
            </tr>
          ) : null}
          {rows.length ? null : (
            <tr>
              <td colSpan={7} className="px-2 py-3 text-deep-violet-blue/60">
                No building blocks or promotions switched on yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
