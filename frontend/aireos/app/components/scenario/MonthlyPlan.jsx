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
 *   skuRange: string,        the Scenario builder's SKU range filter ('' = all)
 *   customerName: string,
 *   startDate: string,
 *   endDate: string,
 *   rows: object[],          forecast rows from GET /api/forecast
 *   actuals: object[],       the page's actuals, used when they already reach last year
 *   byMonth: Map,            simulate().byMonth
 *   monthItems: Map,         month_year → [{ itemId, name }]
 *   onOpenItem: (itemId: string) => void,
 *   scope: string,           what the rows add up, e.g. "Fairprice · All SKUs"
 *   breakdowns: Map,         month_year → the chart point's breakdown (scenarioComposition)
 *   splits: Map,             month_year → scenarioTier0Split.monthSplit (the Promotions column, plan status)
 *   included: Record<string, boolean>, the Breakdown tab's toggles
 *   split: boolean,          Tier 0 is split into its baseline and carried promotions
 *   detailsFor: (month: string) => import('react').ReactNode,
 *   flagged: (month: string) => boolean,
 * }} props
 */
export default function MonthlyPlan({
  ready,
  productName,
  skuRange = '',
  customerName,
  startDate,
  endDate,
  rows,
  actuals,
  byMonth,
  monthItems,
  onOpenItem,
  scope,
  breakdowns,
  splits,
  included,
  split,
  detailsFor,
  flagged,
}) {
  const lastYear = useLastYearActuals({ ready, productName, skuRange, customerName, startDate, endDate, actuals });
  const planRows = buildPlanRows({ rows, lastYearActuals: lastYear.actuals, byMonth, monthItems, breakdowns, splits, included });

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
        included={included}
        split={split}
        detailsFor={detailsFor}
        flagged={flagged}
      />
    </div>
  );
}
