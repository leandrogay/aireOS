'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';

import ConfirmDialog from '@/components/ui/ConfirmDialog';
import BlockEditor from '@/components/scenario/BlockEditor';
import BlockList from '@/components/scenario/BlockList';
import useConfirmAction from '@/hooks/useConfirmAction';
import { retailerLabel } from '@/app/utils/retailerLabel';
import {
  discardBlockChanges,
  hasUnsavedChanges,
  newScenarioBlock,
  updateScenarioBlock,
  validateScenarioBlock,
} from '@/app/utils/scenarioBlocks';
import { monthSpanLabel } from '@/app/utils/scenarioPitch';

/**
 * Building blocks tab of the Scenario builder panel: the blocks as a list,
 * and an editor for the selected one.
 *
 * Edits go to `onChange` and show on the chart at once; `onSave` and
 * `onDelete` keep or remove a block for good. Impact numbers come from the
 * engine (`impacts` = simulate().byItem), so a block with no entry there is
 * switched off or outside the rows the page fetched.
 *
 * @param {{
 *   items: object[],
 *   onChange: (next: object[] | ((items: object[]) => object[])) => void,
 *   onSave: (block: object) => Promise<void>,
 *   onDelete: (block: object) => Promise<void>,
 *   customerOptions: string[],
 *   productOptions: string[],
 *   months: string[],
 *   defaultCustomer: string,
 *   defaultSku: string,
 *   impacts: Map<string, { deltaUnits: number, deltaRevenue: number, months: string[] }>,
 * }} props
 */
export default function BuildingBlocksSection({
  items,
  onChange,
  onSave,
  onDelete,
  customerOptions,
  productOptions,
  months,
  defaultCustomer,
  defaultSku,
  impacts,
}) {
  const [selectedId, setSelectedId] = useState(null);
  // Field errors show only after Save was pressed on that block, so a new
  // block isn't covered in red before the user has typed anything.
  const [triedToSave, setTriedToSave] = useState({});
  const [savingIds, setSavingIds] = useState([]);
  const [saveErrors, setSaveErrors] = useState({});
  const [saveAllMessage, setSaveAllMessage] = useState('');
  const deletion = useConfirmAction({ onConfirm: deleteSaved });

  const selected = items.find((block) => block.id === selectedId) ?? items[0] ?? null;
  const unsaved = items.filter(hasUnsavedChanges);
  const canAdd = months.length > 0 && customerOptions.length > 0;

  function updateBlock(id, changes) {
    onChange((current) => current.map((block) => (block.id === id ? updateScenarioBlock(block, changes) : block)));
    setSaveAllMessage('');
  }

  function addBlock() {
    const block = newScenarioBlock({
      customer: defaultCustomer || customerOptions[0] || '',
      sku: defaultSku,
      months,
    });
    onChange((current) => [...current, block]);
    setSelectedId(block.id);
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
  }

  // A block never saved has nothing on the server, so it goes without asking.
  function requestDelete(block) {
    if (block.saved) {
      deletion.request(block);
    } else {
      onChange((current) => current.filter((item) => item.id !== block.id));
    }
  }

  async function deleteSaved(block) {
    try {
      await onDelete(block);
    } catch (error) {
      setSaveErrors((current) => ({ ...current, [block.id]: error.message }));
    }
  }

  return (
    <div className="space-y-3">
      <BlockList
        blocks={items}
        selectedId={selected?.id ?? null}
        onSelect={setSelectedId}
        onToggle={(block, isActive) => updateBlock(block.id, { isActive })}
        impacts={impacts}
      />

      {items.length ? null : (
        <p className="text-xs text-deep-violet-blue/60">
          No building blocks yet. Add one, such as a new store opening or a gift with purchase, to see how it
          lifts the forecast.
        </p>
      )}

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

      {unsaved.length > 1 || saveAllMessage ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-scenario/40 bg-scenario-soft px-2.5 py-2 text-[11px] text-scenario-ink">
          <span>
            {unsaved.length > 1 ? `${unsaved.length} blocks have unsaved changes.` : saveAllMessage}
          </span>
          {unsaved.length > 1 ? (
            <button
              type="button"
              onClick={saveAll}
              disabled={savingIds.length > 0}
              className="h-7 rounded-md bg-deep-violet-blue px-2.5 font-medium text-white disabled:opacity-50"
            >
              Save all
            </button>
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
          productOptions={productOptions}
          months={months}
          impact={impacts.get(selected.id)}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(deletion.target)}
        title="Delete this building block?"
        description="It will be removed for good. To keep it but take it off the chart, switch it off instead."
        details={
          deletion.target
            ? [
                { label: 'Block', value: deletion.target.name },
                {
                  label: 'Applies to',
                  value: `${retailerLabel(deletion.target.customer)} · ${deletion.target.sku || 'All SKUs'}`,
                },
                {
                  label: 'Months',
                  value: monthSpanLabel([deletion.target.startMonth, deletion.target.endMonth].filter(Boolean)),
                },
              ]
            : undefined
        }
        confirmLabel="Delete block"
        pendingLabel="Deleting…"
        tone="destructive"
        isPending={deletion.isPending}
        onConfirm={deletion.confirm}
        onCancel={deletion.cancel}
      />
    </div>
  );
}
