'use client';

import { useState } from 'react';

import StatusPill from '@/components/ui/StatusPill';
import { cn } from '@/lib/utils';
import {
  MAX_OVERRIDE_PCT, formatPctRange, promotionCustomers, referencesFor, valuesAcrossSkus,
  voucherChange, voucherEdited, voucherOption, voucherReferences,
} from '@/app/utils/scenarioPromotions';

/** Voucher choice and its optional override, below the mechanic's expected uplift. */
export default function PromotionVoucherFields({ promotion, upliftsByCustomer, onUpdate }) {
  const [text, setText] = useState(null);
  const customers = promotionCustomers(promotion);
  const resolved = upliftsByCustomer?.[customers[0]];
  const row = voucherOption(resolved);
  const settings = voucherReferences(promotion, upliftsByCustomer);
  const settingValues = Object.values(settings ?? {}).map((setting) => setting.voucherUpliftPct);
  const changed = voucherEdited(promotion, upliftsByCustomer);
  const value = referencesFor(promotion, customers[0]).voucherUpliftPct ?? 0;
  const ranges = promotion.skuRanges ?? [];
  const single = ranges.length === 1 || (!ranges.length && Boolean(promotion.sku));
  const options = row ? !ranges.length && promotion.sku
    ? [resolved?.product_uplifts?.[promotion.sku]?.[row.mechanic_key] ?? row.uplift_pct]
    : valuesAcrossSkus(resolved, row, ranges) : [];

  function commit() {
    const pct = Number(text);
    setText(null);
    if (text == null || text.trim() === '' || !Number.isFinite(pct)) return;
    const bounded = Math.min(MAX_OVERRIDE_PCT, Math.max(0, Math.round(pct)));
    const reset = settings && settingValues.every((setting) => setting === bounded);
    onUpdate(voucherChange(promotion, reset ? { settings } : { pct: bounded }));
  }

  return (
    <div>
      <span className="mb-0.5 block text-[11px] text-deep-violet-blue/70">
        Voucher{row && !promotion.voucher ? ` · ${formatPctRange(single && settingValues.length ? settingValues : options)}` : ''}
      </span>
      <div className="flex gap-1" role="group" aria-label="Voucher">
        {[{ value: true, label: 'Yes' }, { value: false, label: 'No' }].map((option) => (
          <button key={option.label} type="button" aria-pressed={promotion.voucher === option.value}
            onClick={() => onUpdate({ voucher: option.value })}
            className={cn('h-7 flex-1 rounded-md border text-xs', promotion.voucher === option.value
              ? 'border-deep-violet-blue bg-deep-violet-blue font-medium text-white'
              : 'border-lavander bg-white text-deep-violet-blue hover:bg-cream')}>
            {option.label}
          </button>
        ))}
      </div>
      {promotion.voucher ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <label className="text-[11px] text-deep-violet-blue/70" htmlFor="promo-voucher-uplift">Voucher uplift</label>
          <input id="promo-voucher-uplift" type="number" min={0} max={MAX_OVERRIDE_PCT} step={1}
            value={text ?? String(value)} onChange={(event) => setText(event.target.value)} onBlur={commit}
            onKeyDown={(event) => { if (event.key === 'Enter') commit(); }}
            className="h-8 w-16 rounded-md border border-violet bg-white px-2 text-right text-xs tabular-nums text-deep-violet-blue" />
          <span className="text-[11px] text-deep-violet-blue/70">%</span>
          {changed ? (
            <>
              <StatusPill tone="info">Edited for this promotion</StatusPill>
              <button type="button" onClick={() => onUpdate(voucherChange(promotion, { settings }))}
                className="text-[11px] font-medium text-scenario underline-offset-2 hover:underline">
                Reset to {formatPctRange(settingValues)}
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
