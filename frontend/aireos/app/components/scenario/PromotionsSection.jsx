'use client';

import { Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { primaryButtonClass, secondaryButtonClass } from '@/components/ui/formStyles';
import { glassNoteClass } from '@/components/ui/surfaceStyles';
import { formatPctRange, hasUnsavedPromotionChanges, sourceLabel, stackedModelCells, upliftChangedSinceSaved } from '@/app/utils/scenarioPromotions';
import PromoHowItWorks from './PromoHowItWorks';
import PromotionEditor from './PromotionEditor';
import PromotionList from './PromotionList';

/** Draft promotion editor; saved promotions are managed in the table below the chart. */
export default function PromotionsSection({ editor, plan = 'scenario', customerOptions, skuRangeOptions, months,
  rows = [], pairsFor, impacts, liveIndex = null, liveLoading = false, liveError = null }) {
  const { selected, panelItems, uplifts, saving, error, notice } = editor;
  const savedNow = selected ? upliftChangedSinceSaved(selected, liveIndex) : null;
  return (
    <div className="space-y-3">
      <p className="text-[11px] text-deep-violet-blue/70">Plan a promotion and see its uplift on the chart.</p>
      <PromoHowItWorks />
      {uplifts.error ? <p role="alert" className="rounded-md border border-violet bg-lavander/50 px-2.5 py-2 text-xs text-deep-violet-blue">
        Promotion uplift values could not be loaded: {uplifts.error}
      </p> : null}
      {liveError && plan !== 'budget' ? <p role="alert" className="text-xs text-deep-violet-blue">
        Calculated uplifts could not be loaded; saved values are used: {liveError}
      </p> : null}

      <PromotionList items={panelItems} selectedId={selected?.id} onSelect={editor.select}
        onToggle={editor.toggleDraft} impacts={impacts} liveIndex={liveIndex} disabled={saving} />
      {!panelItems.length ? <p className="text-xs text-deep-violet-blue/60">
        {editor.savedCount ? `${editor.savedCount} saved promotion${editor.savedCount === 1 ? '' : 's'} in the table below. Use Edit there to make changes.`
          : 'No promotions yet. Add one to start simulating.'}
      </p> : null}

      <button type="button" onClick={editor.add} disabled={!editor.canAdd || saving}
        className="flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-deep-violet-blue/40 text-xs font-medium text-deep-violet-blue hover:bg-cream/60 disabled:cursor-not-allowed disabled:opacity-50">
        <Plus className="size-3.5" />{uplifts.loading ? 'Loading uplift values…' : 'Add promotion'}
      </button>
      {months.length && customerOptions.length ? null : <p className="text-[11px] text-deep-violet-blue/60">
        Pick a date range that includes forecast months to add promotions.
      </p>}
      {notice ? <p role="status" className={cn(glassNoteClass, 'px-2.5 py-2 text-[11px] text-deep-violet-blue')}>
        {notice}{' '}<button type="button" onClick={editor.dismissNotice} className="font-medium text-scenario hover:underline">Dismiss</button>
      </p> : null}
      {savedNow ? <p role="status" className="rounded-md border border-violet/40 bg-lavander/40 px-2.5 py-2 text-[11px] text-deep-violet-blue">
        When saved: {formatPctRange(savedNow.saved)} · {sourceLabel(savedNow.savedLevel)}.
        {' '}Now: <b>{formatPctRange(savedNow.now)}</b> · {sourceLabel(savedNow.nowLevel)}.
      </p> : null}

      {selected ? <PromotionEditor promotion={selected} onUpdate={editor.updateSelected} plan={plan}
        upliftsByCustomer={uplifts.data} pairs={pairsFor(selected)} liveIndex={liveIndex} liveLoading={liveLoading}
        customerOptions={customerOptions} skuRangeOptions={skuRangeOptions} months={months}
        impact={impacts.get(selected.id)} stacked={stackedModelCells(selected, rows)} /> : null}
      {error ? <p role="alert" className="text-xs text-deep-violet-blue">{error}</p> : null}
      {selected ? <div className="flex items-center gap-2">
        <Button type="button" onClick={() => editor.save(selected)} disabled={saving || !hasUnsavedPromotionChanges(selected)}
          className={cn(primaryButtonClass, 'flex-1')}>
          {saving ? 'Saving…' : hasUnsavedPromotionChanges(selected) ? 'Save promotion' : 'Saved'}
        </Button>
        {selected.saved ? <Button type="button" variant="outline" onClick={() => editor.discard(selected)}
          disabled={saving} className={secondaryButtonClass}>
          {hasUnsavedPromotionChanges(selected) ? 'Discard changes' : 'Close'}
        </Button> : null}
        <Button type="button" variant="outline" size="icon" onClick={() => editor.requestDelete(selected)} disabled={saving}
          aria-label={`Delete ${selected.mechanicLabel || 'promotion'}`} title="Delete promotion">
          <Trash2 />
        </Button>
      </div> : null}
    </div>
  );
}
