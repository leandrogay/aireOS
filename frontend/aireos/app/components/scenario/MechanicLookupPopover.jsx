'use client';

import Link from 'next/link';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { formatPct, sourceLabel } from '@/app/utils/scenarioPromotions';

/**
 * "See expected uplift by mechanic": every resolved uplift for the
 * promotion's customer with its source tag, so users can compare mechanics
 * before choosing one, and a link to where the values are edited.
 *
 * @param {{ uplifts: object[], anchorPct: number | null }} props rows from resolved.uplifts
 */
export default function MechanicLookupPopover({ uplifts, anchorPct }) {
  return (
    <Popover>
      <PopoverTrigger className="text-[11px] font-medium text-scenario underline-offset-2 hover:underline">
        See expected uplift by mechanic
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 text-xs text-deep-violet-blue">
        <table className="w-full">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-deep-violet-blue/60">
              <th className="pb-1 text-left font-semibold">Mechanic</th>
              <th className="pb-1 text-right font-semibold">Uplift</th>
              <th className="pb-1 text-right font-semibold">Source</th>
            </tr>
          </thead>
          <tbody>
            {uplifts.map((row) => (
              <tr key={row.mechanic_key} className="border-t border-lavander/70">
                <td className="py-1">{row.mechanic_label}</td>
                <td className="py-1 text-right tabular-nums">{formatPct(row.uplift_pct)}</td>
                <td className="py-1 text-right text-[11px] text-deep-violet-blue/60">{sourceLabel(row.source)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[11px] text-deep-violet-blue/60">
          Relative to an ordinary month{anchorPct != null ? ` (${anchorPct}% off for this customer)` : ''}. Values are
          edited on{' '}
          <Link href="/promo-uplift-settings" className="font-medium text-scenario underline-offset-2 hover:underline">
            Promotion uplift settings
          </Link>
          .
        </p>
      </PopoverContent>
    </Popover>
  );
}
