'use client';

import ToggleField from '@/components/ui/ToggleField';
import { customerLabel } from '@/app/utils/retailerLabel';

function signedUnits(value) {
  const rounded = Math.round(value);
  return `${rounded < 0 ? '−' : '+'}${Math.abs(rounded).toLocaleString('en-US')}`;
}

/**
 * Each customer x SKU range a building block or scenario promotion covers,
 * switched on or off on its own while the item stays one entry
 * (scenarioEngine.itemPairs), with what the item adds there while it is on.
 * Used by the blocks table's opened row and the promotion editor.
 *
 * @param {{
 *   pairs: ReturnType<typeof import('@/app/utils/scenarioEngine').itemPairs>,
 *   active: boolean,              the item is switched on (else no figures)
 *   disabled?: boolean,
 *   onToggle: (customer: string, skuRange: string | null, on: boolean) => void,
 * }} props
 */
export default function ItemPairs({ pairs, active, disabled = false, onToggle }) {
  if (!pairs.length) return null;
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-deep-violet-blue/60">
        Customers × SKU ranges
      </p>
      <ul className="divide-y divide-lavander/70">
        {pairs.map((pair) => (
          <li key={`${pair.customer}|${pair.skuRange ?? ''}`} className="flex items-center justify-between gap-3 py-1.5">
            <ToggleField
              label={`${customerLabel(pair.customer)} · ${pair.skuRange ?? 'No SKU range'}`}
              checked={!pair.excluded}
              onChange={(on) => onToggle(pair.customer, pair.skuRange, on)}
              disabled={disabled}
              tone="scenario"
            />
            <span className="shrink-0 text-xs font-semibold tabular-nums text-scenario-ink">
              {pair.excluded || !active ? '—' : signedUnits(pair.deltaUnits)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
