'use client';

import MonthlyPlanTable from '@/components/scenario/MonthlyPlanTable';
import { buildPlanRows } from '@/app/utils/scenarioPlan';
import useLastYearActuals from '@/hooks/useLastYearActuals';

/**
 * The monthly plan for whatever the filters select (one SKU, or every SKU
 * and customer summed per month): loads last year's actuals (only while
 * this tab is open) and builds the rows from the page's forecast rows and
 * the engine's per-month uplift.
 *
 * @param {{
 *   ready: boolean,
 *   productName: string,
 *   customerName: string,
 *   startDate: string,
 *   endDate: string,
 *   rows: object[],          forecast rows from GET /api/forecast
 *   actuals: object[],       the page's actuals, used when they already reach last year
 *   byMonth: Map,            simulate().byMonth
 *   monthItems: Map,         month_year → [{ itemId, name }]
 *   onOpenItem: (itemId: string) => void,
 *   scope: string,           what the rows add up, e.g. "Fairprice · All SKUs"
 * }} props
 */
export default function MonthlyPlan({
  ready,
  productName,
  customerName,
  startDate,
  endDate,
  rows,
  actuals,
  byMonth,
  monthItems,
  onOpenItem,
  scope,
}) {
  const lastYear = useLastYearActuals({ ready, productName, customerName, startDate, endDate, actuals });
  const planRows = buildPlanRows({ rows, lastYearActuals: lastYear.actuals, byMonth, monthItems });

  return (
    <div className="space-y-1.5">
      {lastYear.error ? (
        <p className="rounded-md border border-violet bg-lavander/50 px-3 py-2 text-xs text-deep-violet-blue">
          {lastYear.error}
        </p>
      ) : null}
      <MonthlyPlanTable
        rows={planRows}
        lastYearLoading={lastYear.loading}
        onOpenItem={onOpenItem}
        scope={scope}
      />
    </div>
  );
}
