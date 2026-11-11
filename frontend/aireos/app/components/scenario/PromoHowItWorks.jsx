'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Collapsible plain-words explanation of how a draft promotion changes the
 * forecast (Promotions Uplift design, Sections 4 and 6.4.5).
 */
export default function PromoHowItWorks() {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-md border border-lavander bg-cream/40 text-[11px] text-deep-violet-blue/80">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-2.5 py-1.5 font-medium text-deep-violet-blue"
      >
        How promotions change the forecast
        <ChevronDown className={cn('size-3.5 transition', open && 'rotate-180')} aria-hidden="true" />
      </button>
      {open ? (
        <ul className="list-disc space-y-1 px-2.5 pb-2 pl-6">
          <li>
            The Current forecast is an <b>ordinary month</b>: every month in the history had a promotion, so the usual
            mix is already inside it.
          </li>
          <li>
            Each mechanic has an uplift relative to that ordinary month. Deeper discounts are positive; shallower ones
            are negative.
          </li>
          <li>A voucher (Yes) adds one extra uplift on top.</li>
          <li>
            Extra units = Current units × uplift. Example: 2,000 units × +4% = +80 units. Every item is worked out from
            the same Current forecast and the results are added, not multiplied.
          </li>
          <li>
            The Scenario builder always starts from <b>Tier 0 · Baseline</b>, which never includes the promotions
            entered on the Promotions page, so your promotion is never added on top of one already in the forecast.
          </li>
          <li>
            Each uplift is worked out on Promotion uplift settings against the anchor in effect that month: measured
            from sales where there are enough promotion months, otherwise a placeholder rule. Saved promotions follow
            those values as they change; an uplift edited here counts for this scenario only.
          </li>
          <li>
            The Scenario builder is for exploring: the Simulated line is never saved into the official forecast.
            The Current forecast, Inventory and Dashboard change only through new sales data and the forecasting
            model, and a promotion entered on the Promotions page only affects months forecast by Tier 1 · Advanced,
            and then only by its type (not its discount depth or voucher).
          </li>
        </ul>
      ) : null}
    </div>
  );
}
