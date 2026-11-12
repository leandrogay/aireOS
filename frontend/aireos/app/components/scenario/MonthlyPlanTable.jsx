'use client';

import { TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import ExpandableRow from '@/components/ui/ExpandableRow';
import InfoTooltip from '@/components/ui/InfoTooltip';
import TableGrid from '@/components/ui/TableGrid';
import { formatMonthLabel } from '@/app/utils/forecastView';
import useExpandedRows from '@/hooks/useExpandedRows';
import MonthlyPlanDetails from './MonthlyPlanDetails';

// As every list table's figures: numbers right-aligned (ForecastYearTotals, ScenarioYearComparison).
const cellClass = 'px-4 py-2.5 text-right align-middle tabular-nums';

function units(value) {
  return Math.round(value).toLocaleString('en-US');
}

function signed(value) {
  return `${value < 0 ? '−' : '+'}${units(Math.abs(value))}`;
}

function Header({ label, hint }) {
  return (
    <span className="inline-flex items-center gap-1">
      {label}<InfoTooltip label={`About ${label}`}>{hint}</InfoTooltip>
    </span>
  );
}

/**
 * Compact monthly figures; mechanics, item names and the Tier 0 explanation
 * are available in the expanded contribution table.
 * @param {{ rows: object[], lastYearLoading: boolean, onOpenItem: (id: string) => void,
 *   scope: string, split: boolean, baseLabel?: string,
 *   detailsFor: (month: string) => import('react').ReactNode, flagged: (month: string) => boolean,
 *   allowOfficialPlanning?: boolean }} props
 */
export default function MonthlyPlanTable({ rows, lastYearLoading, onOpenItem, scope, split, detailsFor, flagged, baseLabel = 'Current', allowOfficialPlanning = true }) {
  const expanded = useExpandedRows();
  const columns = [
    { key: 'month', label: 'Month', width: '10rem' },
    { key: 'lastYear', label: 'Last year actual', width: '8rem', align: 'right' },
    { key: 'base', label: baseLabel, width: '8rem', align: 'right' },
    { key: 'adjustments', label: <Header label="Adjustments" hint={`Net change on ${baseLabel}. Open the month to see each contribution.`} />, width: '8rem', align: 'right' },
    { key: 'simulated', label: 'Simulated', width: '8rem', align: 'right' },
    { key: 'variance', label: <Header label="vs last year" hint="Simulated minus the same month's actual sales last year, in units." />, width: '8rem', align: 'right' },
    { key: 'variancePct', label: 'vs last year %', align: 'right' },
  ];
  return (
    <section aria-label="Monthly plan">
      <p className="px-4 pb-3 text-xs text-deep-violet-blue/60">
        <span className="font-medium text-deep-violet-blue">{scope}</span> · Open a month for contributions and {split ? 'its Tier 0 calculation' : 'baseline details'}.
      </p>
      <TableGrid variant="nested" columns={columns} minWidth="56rem"
        emptyState={!rows.length ? 'No forecast months in this period. Select a period with forecast data.' : null}>
        {rows.map((row) => {
          const label = formatMonthLabel(row.month_year);
          const isOpen = expanded.isExpanded(row.month_year);
          const change = row.variance;
          const changeClass = change && (change.units < 0 ? 'text-red-700' : 'text-emerald-700');
          return (
            <ExpandableRow key={row.month_year} columnCount={columns.length} isOpen={isOpen}
              onToggle={() => expanded.toggle(row.month_year)} primary={(
                <span className="inline-flex items-center gap-1.5">
                  {label}
                  {flagged(row.month_year) ? (
                    <span title="Big change: review this month's promotion contributions">
                      <TriangleAlert className="size-3.5 text-amber-700" aria-label="Big change" />
                    </span>
                  ) : null}
                </span>
              )}
              toggleLabel={`${isOpen ? 'Hide' : 'Show'} details for ${label}`}
              details={(
                <MonthlyPlanDetails row={row} split={split} baseLabel={baseLabel} month={label}
                  allowOfficialPlanning={allowOfficialPlanning}
                  flagged={flagged(row.month_year)} onOpenItem={onOpenItem}>
                  {detailsFor(row.month_year)}
                </MonthlyPlanDetails>
              )}>
              <td className={cellClass}>
                {row.lastYear ? units(row.lastYear.units) : <span className="text-deep-violet-blue/45">{lastYearLoading ? '…' : 'No sales'}</span>}
              </td>
              <td className={cellClass}>{units(row.model.units)}</td>
              <td className={cn(cellClass, 'text-scenario-ink')}>{signed(row.adjusted.units - row.model.units)}</td>
              <td className={cn(cellClass, 'font-semibold text-scenario-ink')}>{units(row.adjusted.units)}</td>
              <td className={cn(cellClass, changeClass)}>{change ? signed(change.units) : lastYearLoading ? '…' : '—'}</td>
              <td className={cn(cellClass, changeClass)}>
                {change?.unitsPct != null ? `${change.unitsPct < 0 ? '−' : '+'}${Math.abs(change.unitsPct * 100).toFixed(1)}%` : '—'}
              </td>
            </ExpandableRow>
          );
        })}
      </TableGrid>
    </section>
  );
}
