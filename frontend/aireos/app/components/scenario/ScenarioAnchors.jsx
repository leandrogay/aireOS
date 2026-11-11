'use client';

import { useState } from 'react';
import Link from 'next/link';

import SelectDropdown from '@/components/ui/SelectDropdown';
import { formatMonthLabel } from '@/app/utils/forecastView';
import { monthText } from '@/app/utils/promoUpliftCalc';
import { anchorInMonth, anchorLabel, anchorSourceLabel, anchorTargets } from '@/app/utils/promoUpliftSettings';
import { customerLabel } from '@/app/utils/retailerLabel';

const ALL = '';

/**
 * The Breakdown tab's anchors: every customer's and SKU range's ordinary-month
 * mechanic in the picked month, and each later change as a step ("→ 15% Off ·
 * 15% from Jun 2027 · Projected from official promotions"). Filtered by
 * customer and SKU range, starting on the chart's own; read-only, since
 * anchors are changed on Promotion uplift settings.
 *
 * @param {{
 *   anchors: { data: object | null, loading: boolean, error: string | null },
 *   month: string,
 *   customerName: string,
 *   skuRange: string,
 * }} props `anchors` from usePromoAnchors; customerName / skuRange the chart's ('' = all)
 */
export default function ScenarioAnchors({ anchors, month, customerName, skuRange }) {
  // null = follow the chart's filter.
  const [pickedCustomer, setPickedCustomer] = useState(null);
  const [pickedRange, setPickedRange] = useState(null);
  const targets = anchorTargets(anchors.data);
  const customers = [...new Set(targets.map((target) => target.customerName))];
  const ranges = [...new Set(targets.map((target) => target.skuRange).filter(Boolean))].sort();
  // The chart's pick only while it has anchors (and they have loaded), so
  // the picker never shows a value it has no option for.
  const chartCustomer = customers.includes(customerName) ? customerName : ALL;
  const chartRange = ranges.includes(skuRange) ? skuRange : ALL;
  const customer = pickedCustomer ?? chartCustomer;
  const range = pickedRange ?? chartRange;
  const shown = targets.filter(
    (target) =>
      (!customer || target.customerName === customer) &&
      // A range picked shows that range; All SKU ranges shows each customer's own and every range.
      (!range || target.skuRange === range)
  );

  return (
    <div className="rounded border border-lavander/80 bg-lavander/20 p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <p className="text-[10px] font-bold uppercase tracking-wide text-deep-violet-blue/55">
          Anchors in {formatMonthLabel(month)}
        </p>
        <div className="flex flex-wrap gap-1">
          <SelectDropdown
            value={customer}
            onChange={setPickedCustomer}
            options={[
              { value: ALL, label: 'All customers' },
              ...customers.map((name) => ({ value: name, label: customerLabel(name) })),
            ]}
            ariaLabel="Customer for anchors"
            look="compact"
            size="sm"
          />
          <SelectDropdown
            value={range}
            onChange={setPickedRange}
            options={[{ value: ALL, label: 'All SKU ranges' }, ...ranges.map((name) => ({ value: name, label: name }))]}
            ariaLabel="SKU range for anchors"
            look="compact"
            size="sm"
          />
        </div>
      </div>

      {anchors.error ? (
        <p
          className="mt-1 rounded-md border border-violet bg-lavander/50 px-2.5 py-2 text-xs text-deep-violet-blue"
          role="alert"
        >
          Anchors could not be loaded: {anchors.error}
        </p>
      ) : anchors.loading ? (
        <p className="mt-1 text-[11px] text-deep-violet-blue/60">Loading anchors…</p>
      ) : shown.length ? (
        <div className="mt-1 max-h-64 overflow-y-auto">
          <table className="w-full text-xs text-deep-violet-blue">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-deep-violet-blue/60">
                <th className="pb-1 text-left font-semibold">Customer · range</th>
                <th className="pb-1 text-right font-semibold">Anchor</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((target) => {
                const inMonth = anchorInMonth(target.entry, month);
                const later = (target.entry.upcoming ?? []).filter((change) => change.effective_from > month);
                return (
                  <tr key={target.key} className="border-t border-lavander/70 align-top">
                    <td className="py-1 pr-2">
                      {customerLabel(target.customerName)}
                      <span className="block text-[11px] text-deep-violet-blue/60">
                        {target.skuRange ?? 'Customer anchor'}
                      </span>
                    </td>
                    <td className="py-1 text-right">
                      <span className="font-medium tabular-nums">{anchorLabel(inMonth)}</span>
                      <span className="block text-[11px] text-deep-violet-blue/60">{anchorSourceLabel(inMonth.source)}</span>
                      {later.map((change) => (
                        <span key={change.effective_from} className="block text-[11px] text-deep-violet-blue/60">
                          → {anchorLabel(change)} from {monthText(change.effective_from)} ·{' '}
                          {anchorSourceLabel(change.source)}
                        </span>
                      ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-1 text-[11px] text-deep-violet-blue/60">No anchors match these filters.</p>
      )}

      <p className="mt-1.5 text-[11px] text-deep-violet-blue/60">
        Uplifts are measured against these. Change them on{' '}
        <Link href="/promo-uplift-settings" className="font-medium text-scenario underline-offset-2 hover:underline">
          Promotion uplift settings
        </Link>
        .
      </p>
    </div>
  );
}
