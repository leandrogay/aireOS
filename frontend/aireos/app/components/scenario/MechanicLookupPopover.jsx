'use client';

import Link from 'next/link';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
/**
 * "See expected uplift by mechanic": what each mechanic is worth for this
 * promotion now, with how it was worked out, so users can compare mechanics
 * before choosing one, and a link to where the values are worked out.
 *
 * @param {{ rows: { key: string, label: string, uplift: string, basis: string }[], anchorPct: number | null }} props
 *   one per mechanic, as the editor's mechanic list shows them
 */
export default function MechanicLookupPopover({ rows, anchorPct }) {
  return (
    <Popover>
      <PopoverTrigger className="text-[11px] font-medium text-scenario underline-offset-2 hover:underline">
        See expected uplift by mechanic
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 text-xs text-deep-violet-blue">
        <table className="w-full">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-deep-violet-blue/60">
              <th className="pb-1 text-left font-semibold">Mechanic</th>
              <th className="pb-1 text-right font-semibold">Uplift</th>
              <th className="pb-1 text-right font-semibold">Basis</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-t border-lavander/70">
                <td className="py-1">{row.label}</td>
                <td className="py-1 text-right tabular-nums">{row.uplift}</td>
                <td className="py-1 text-right text-[11px] text-deep-violet-blue/60">{row.basis}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[11px] text-deep-violet-blue/60">
          Relative to an ordinary month{anchorPct != null ? ` (${anchorPct}% off for this customer)` : ''}. Values are
          worked out on{' '}
          <Link href="/promo-uplift-settings" className="font-medium text-scenario underline-offset-2 hover:underline">
            Promotion uplift settings
          </Link>
          .
        </p>
      </PopoverContent>
    </Popover>
  );
}
