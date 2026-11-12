'use client';

import { Percent } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { customersLabel } from '@/app/utils/retailerLabel';
import { monthSpanLabel } from '@/app/utils/scenarioPitch';
import { effectiveUpliftRange, formatPctRange, hasUnsavedPromotionChanges, promotionScopeLabel } from '@/app/utils/scenarioPromotions';

/** Drafts and the saved promotion currently being edited; saved records live in PromotionTable. */
export default function PromotionList({ items, selectedId, onSelect, onToggle, impacts, liveIndex, disabled }) {
  return (
    <ul className="space-y-1.5">
      {items.map((promotion) => (
        <li key={promotion.id} className={cn('flex items-center gap-2 rounded-md border pr-2.5 transition',
          promotion.id === selectedId ? 'border-deep-violet-blue bg-lavander/40' : 'border-lavander bg-white hover:bg-cream/60')}>
          <button type="button" onClick={() => onSelect(promotion.id)} aria-pressed={promotion.id === selectedId}
            className={cn('flex min-w-0 flex-1 items-start gap-2 px-2.5 py-2 text-left', !promotion.isActive && 'opacity-60')}>
            <Percent className="mt-0.5 size-3.5 shrink-0 text-scenario" aria-hidden="true" />
            <span className="min-w-0">
              <span className="block truncate text-xs font-medium text-deep-violet-blue">
                {customersLabel(promotion.customers)} · {promotion.mechanicLabel || 'Draft promotion'}
              </span>
              <span className="block truncate text-[11px] text-deep-violet-blue/60">
                {promotionScopeLabel(promotion)} · {formatPctRange(effectiveUpliftRange(promotion, liveIndex))}
                {promotion.voucher ? ' + voucher' : ''} · {monthSpanLabel([promotion.startMonth, promotion.endMonth])}
              </span>
              <span className={cn('block text-[11px]', hasUnsavedPromotionChanges(promotion)
                ? 'font-medium text-scenario-ink' : 'italic text-deep-violet-blue/50')}>
                {hasUnsavedPromotionChanges(promotion) ? 'Unsaved changes' : promotion.isActive ? 'Saved' : 'Saved, switched off'}
              </span>
              {impacts.has(promotion.id) ? null : <span className="block text-[11px] italic text-deep-violet-blue/50">Not applied in current chart view</span>}
            </span>
          </button>
          <Switch checked={promotion.isActive} disabled={disabled} onCheckedChange={(checked) => onToggle(promotion, checked)}
            aria-label={`${promotion.isActive ? 'Make inactive' : 'Make active'}: ${promotion.mechanicLabel || 'promotion'}`}
            className="data-checked:bg-scenario" />
        </li>
      ))}
    </ul>
  );
}
