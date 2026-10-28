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
            Some months&apos; official forecast already includes the promotion entered for them, so planned promotions
            are not added there and nothing is counted twice. Switch to <b>Plan my own promotions</b> above the chart
            to use the forecast without it and plan those months yourself. Building blocks apply in both views.
          </li>
          <li>Uplifts are rule-based (+0.4% per extra point of discount, by default) until they are measured from sales data.</li>
          <li>
            The Scenario builder is for exploring: the Simulated line is never saved into the official forecast.
            The Current forecast, Inventory and Dashboard change only through new sales data and the forecasting
            model, and a promotion entered on the Promotions page only affects months forecast by Tier 1 advanced,
            and then only by its type (not its discount depth or voucher).
          </li>
        </ul>
      ) : null}
    </div>
  );
}
