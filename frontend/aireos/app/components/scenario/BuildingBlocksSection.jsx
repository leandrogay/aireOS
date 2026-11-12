'use client';

import { useState } from 'react';
import { Layers, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { primaryButtonClass } from '@/components/ui/formStyles';
import BlockEditor from '@/components/scenario/BlockEditor';
import BlockList from '@/components/scenario/BlockList';
import {
  discardBlockChanges,
  hasUnsavedChanges,
  newScenarioBlock,
  updateScenarioBlock,
  validateScenarioBlock,
} from '@/app/utils/scenarioBlocks';

// Switched-on saved blocks the chart's filters leave out.
function elsewhereNote(count) {
  return `${count} more switched-on block${count === 1 ? ' is' : 's are'} for another customer, SKU range or period.`;
}

/**
 * Building blocks in the Scenario builder panel: blocks not saved yet, plus
 * the saved block being edited (saved blocks live in the table under the
 * chart), and an editor for the selected one.
 *
 * Edits go to `onChange` (over every block) and show on the chart at once;
 * `onSave` keeps a block, after which it leaves the panel for the table.
 * Deleting a saved block goes through the page's confirm (`onRequestDelete`);
 * a block never saved goes without asking. `onClose` runs when a saved
 * block's changes are discarded, so it returns to the table. Impact numbers
 * come from the engine (`impacts` = simulate().byItem).
 *
 * @param {{
 *   items: object[],                  blocks shown in the panel
 *   savedCount: number,               saved blocks, for the empty state
 *   selectedId: string | null,
 *   onSelect: (id: string | null) => void,
 *   onChange: (next: object[] | ((items: object[]) => object[])) => void,
 *   onSave: (block: object) => Promise<void>,
 *   onRequestDelete: (block: object) => void,
 *   onClose: () => void,
 *   customerOptions: string[],
 *   skuRangeOptions: string[],
 *   months: string[],
 *   pastMonths?: string[],            months on the chart with actuals (milestones)
 *   defaultCustomer: string,
 *   defaultSkuRange: string,
 *   impacts: Map<string, { deltaUnits: number, months: string[] }>,
 *   savedOnChart: object[],           saved, switched-on blocks for the chart's filters, not open in the panel
 *   savedElsewhereCount: number,      saved, switched-on blocks for other customers, SKUs or months
 *   onEditSaved: (block: object) => void,
 *   onToggleSaved: (block: object, isActive: boolean) => void, saves the switch at once
 *   togglingIds: string[],
 *   closedIds: Set<string>,           blocks whose months all have actual sales
 * }} props
 */
export default function BuildingBlocksSection({
  items,
  savedCount,
  selectedId,
  onSelect,
  onChange,
  onSave,
  onRequestDelete,
  onClose,
  customerOptions,
  skuRangeOptions,
  months,
  pastMonths = [],
  defaultCustomer,
  defaultSkuRange,
  impacts,
  savedOnChart,
  savedElsewhereCount,
  onEditSaved,
  onToggleSaved,
  togglingIds,
  closedIds,
}) {
  // Field errors show only after Save was pressed on that block, so a new
  // block isn't covered in red before the user has typed anything.
  const [triedToSave, setTriedToSave] = useState({});
  const [savingIds, setSavingIds] = useState([]);
  const [saveErrors, setSaveErrors] = useState({});
  const [saveAllMessage, setSaveAllMessage] = useState('');

  const selected = items.find((block) => block.id === selectedId) ?? items[0] ?? null;
  const unsaved = items.filter(hasUnsavedChanges);
  const canAdd = months.length > 0 && customerOptions.length > 0;

  function updateBlock(id, changes) {
    onChange((current) => current.map((block) => (block.id === id ? updateScenarioBlock(block, changes) : block)));
    setSaveAllMessage('');
  }

  function addBlock() {
    const block = newScenarioBlock({
      // The chart's customer and range to start with; none = every customer /
      // All SKU ranges.
      customers: defaultCustomer ? [defaultCustomer] : [],
      skuRanges: defaultSkuRange ? [defaultSkuRange] : [],
      months,
    });
    onChange((current) => [...current, block]);
    onSelect(block.id);
  }

  // Returns true when the block was saved, so Save all can count them.
  async function save(block) {
    setTriedToSave((current) => ({ ...current, [block.id]: true }));
    if (Object.keys(validateScenarioBlock(block)).length) return false;
    setSavingIds((current) => [...current, block.id]);
    setSaveErrors((current) => ({ ...current, [block.id]: null }));
    try {
      await onSave(block);
      return true;
    } catch (error) {
      setSaveErrors((current) => ({ ...current, [block.id]: error.message }));
      return false;
    } finally {
      setSavingIds((current) => current.filter((id) => id !== block.id));
    }
  }

  async function saveAll() {
    let saved = 0;
    for (const block of unsaved) {
      if (await save(block)) saved += 1;
    }
    const left = unsaved.length - saved;
    setSaveAllMessage(
      left
        ? `${saved} saved. ${left} still need${left === 1 ? 's' : ''} fixing: look for the red notes.`
        : `${saved} block${saved === 1 ? '' : 's'} saved.`
    );
  }

  function discard(block) {
    const restored = discardBlockChanges(block);
    onChange((current) => current.map((item) => (item.id === block.id ? restored : item)).filter(Boolean));
    setTriedToSave((current) => ({ ...current, [block.id]: false }));
    if (block.saved) onClose();
  }

  // A block never saved has nothing on the server, so it goes without asking.
  function requestDelete(block) {
    if (block.saved) {
      onRequestDelete(block);
    } else {
      onChange((current) => current.filter((item) => item.id !== block.id));
    }
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={addBlock}
        disabled={!canAdd}
        className="flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-deep-violet-blue/40 text-xs font-medium text-deep-violet-blue hover:bg-cream/60 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Plus className="size-3.5" />
        Add building block
      </button>
      {canAdd ? null : (
        <p className="text-[11px] text-deep-violet-blue/60">
          Pick a date range that includes forecast months to add building blocks.
        </p>
      )}

      <BlockList
        blocks={items}
        selectedId={selected?.id ?? null}
        onSelect={onSelect}
        onToggle={(block, isActive) => updateBlock(block.id, { isActive })}
        impacts={impacts}
        closedIds={closedIds}
      />

      {/* Nothing open to edit: the saved blocks on the chart as cards (click
          to edit, switch to take one off), or an empty state when there are none. */}
      {items.length ? null : savedOnChart.length ? (
        <section className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-deep-violet-blue/60">
            On the chart · {savedOnChart.length} saved
          </p>
          <BlockList
            blocks={savedOnChart}
            selectedId={null}
            onSelect={(id) => onEditSaved(savedOnChart.find((block) => block.id === id))}
            onToggle={onToggleSaved}
            impacts={impacts}
            closedIds={closedIds}
            togglingIds={togglingIds}
          />
          {savedElsewhereCount ? <p className="text-[11px] text-deep-violet-blue/60">{elsewhereNote(savedElsewhereCount)}</p> : null}
        </section>
      ) : (
        <div className="flex flex-col items-center rounded-lg border border-dashed border-lavander px-4 py-8 text-center">
          <span className="mb-2 flex size-10 items-center justify-center rounded-full bg-lavander text-deep-violet-blue">
            <Layers className="size-5" aria-hidden="true" />
          </span>
          <p className="font-serif text-base text-deep-violet-blue">
            {savedCount ? 'Nothing on the chart' : 'No building blocks yet'}
          </p>
          <p className="mt-1 max-w-xs text-xs text-deep-violet-blue/60">
            {savedElsewhereCount
              ? `${elsewhereNote(savedElsewhereCount)} Change the filters to see them, or add a new one.`
              : savedCount
                ? 'Saved blocks are in the table under the chart. Switch one on there, or add a new one.'
                : 'Add one, such as a new store opening, a gift with purchase or a flood, to see how it moves the forecast.'}
          </p>
        </div>
      )}


      {unsaved.length > 1 || saveAllMessage ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-violet bg-lavander/50 px-2.5 py-2 text-[11px] text-deep-violet-blue">
          <span>
            {unsaved.length > 1 ? `${unsaved.length} blocks have unsaved changes.` : saveAllMessage}
          </span>
          {unsaved.length > 1 ? (
            <Button type="button" onClick={saveAll} disabled={savingIds.length > 0} className={primaryButtonClass}>
              Save all
            </Button>
          ) : null}
        </div>
      ) : null}

      {selected ? (
        <BlockEditor
          block={selected}
          onChange={(changes) => updateBlock(selected.id, changes)}
          onSave={() => save(selected)}
          onDiscard={() => discard(selected)}
          onDelete={() => requestDelete(selected)}
          errors={triedToSave[selected.id] ? validateScenarioBlock(selected) : {}}
          saving={savingIds.includes(selected.id)}
          saveError={saveErrors[selected.id] ?? null}
          customerOptions={customerOptions}
          skuRangeOptions={skuRangeOptions}
          months={months}
          pastMonths={pastMonths}
          impact={impacts.get(selected.id)}
        />
      ) : null}
    </div>
  );
}
