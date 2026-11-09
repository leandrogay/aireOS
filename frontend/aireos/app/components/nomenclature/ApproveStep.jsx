'use client';

import { CheckCircle2, Circle, Trash2 } from 'lucide-react';

import Disclosure from '@/components/ui/Disclosure';
import { inputClass, labelClass } from '@/components/ui/formStyles';
import { GUIDED_STEPS, stepForItem } from '@/app/utils/guidedSteps';
import { isAiProposal } from '@/app/utils/mappingReview';

import FieldTable from '../mappings/FieldTable';
import FileSettings from '../mappings/FileSettings';
import FileTop from '../mappings/FileTop';
import SkuCodeTable from '../mappings/SkuCodeTable';

/**
 * "Name it and approve": the name (prefilled), every condition approval waits
 * on (utils/reviewChecklist) with a way back to the screen that settles an
 * open one, and -- for whoever wants to see the whole of it before approving
 * -- every field, the product codes, the file settings and the top of the
 * file, editable, as on the full review. Approve itself is the frame's main
 * button.
 *
 * @param {{
 *   review: ReturnType<import('@/hooks/useGuidedReview').default>,
 *   mapping: object,
 *   steps: string[],
 *   onGoTo: (key: string) => void,
 *   onEdit: (entry: object) => void,
 *   onDiscard: () => void,
 *   disabled: boolean,
 * }} props
 */
export default function ApproveStep({ review, mapping, steps, onGoTo, onEdit, onDiscard, disabled }) {
  const { edits, items, codes, issues } = review;

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <div className="space-y-3">
          <div>
            <label htmlFor="guided-name" className={labelClass}>
              What should we call it?
            </label>
            <input
              id="guided-name"
              type="text"
              value={review.name}
              maxLength={120}
              required
              disabled={disabled}
              onChange={(event) => review.setName(event.target.value)}
              placeholder="e.g. FairPrice monthly sell-out"
              className={`${inputClass} h-10 text-base`}
            />
          </div>

          {review.message && (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {review.message}
            </p>
          )}

          {isAiProposal(mapping.proposedBy) && mapping.state !== 'confirmed' && (
            <p className="text-sm text-deep-violet-blue/80">
              AI can make mistakes. Approving saves how files like this are read; no sales are loaded yet.
            </p>
          )}

          {review.canDiscard && (
            <button
              type="button"
              onClick={onDiscard}
              disabled={disabled}
              className="inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 text-sm font-medium text-red-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700/40"
            >
              <Trash2 aria-hidden="true" className="size-4" />
              Discard this proposal instead
            </button>
          )}
        </div>

        <div className="rounded-lg border border-lavander p-3">
          <p className="text-sm font-medium text-deep-violet-blue">Before you approve</p>
          <ol className="mt-2 space-y-1">
            {items.map((item) => {
              const target = stepForItem(item.id, steps);
              return (
                <li key={item.id} className="flex items-start gap-2">
                  {item.done ? (
                    <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-green-700" />
                  ) : (
                    <Circle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-amber-700" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className={item.done ? 'block text-sm text-deep-violet-blue/80' : 'block text-sm font-medium text-deep-violet-blue'}>
                      <span className="sr-only">{item.done ? 'Done: ' : 'To do: '}</span>
                      {item.label}
                    </span>
                    {item.detail && !item.done && <span className="block text-xs text-amber-900">{item.detail}</span>}
                  </span>
                  {!item.done && target !== 'approve' && (
                    <button
                      type="button"
                      onClick={() => onGoTo(target)}
                      className="shrink-0 rounded-md px-1.5 py-0.5 text-xs font-medium text-deep-violet-blue underline underline-offset-2 hover:bg-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-deep-violet-blue"
                    >
                      Go to {GUIDED_STEPS[target].label}
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      </div>

      <Disclosure className="rounded-lg border border-lavander bg-white" summary="See everything before approving">
        <div className="space-y-3 border-t border-lavander p-3">
          <FieldTable
            coverage={issues.coverage}
            mapping={mapping}
            rows={edits.rows}
            groups={edits.groups}
            confirmedNow={edits.confirmedNow}
            onAssign={edits.assignColumn}
            onChooseGroup={edits.chooseGroup}
            onClear={edits.clearField}
            onConfirm={edits.confirmField}
            onUndo={edits.undoConfirm}
            onGroupSettingsChange={edits.changeGroupSettings}
            onEdit={onEdit}
            canResetField={(field) => edits.canResetFields([field])}
            onResetField={(field) => edits.resetFields([field])}
            disabled={disabled}
          />
          {codes.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-deep-violet-blue">Product codes</p>
              <SkuCodeTable
                rows={codes}
                masterSkus={mapping.masterSkus || []}
                masterAvailable={review.masterAvailable}
                onChange={edits.setSkuCode}
                codeChanged={edits.codeChanged}
                onResetCode={(code) => edits.resetSkuCodes([code])}
                readOnly={disabled}
              />
            </div>
          )}
          <FileSettings
            instructions={edits.instructions}
            changed={edits.instructionsChanged}
            onChange={edits.setInstruction}
            onReset={edits.resetInstructions}
            disabled={disabled}
          />
          <FileTop columns={mapping.columns || []} layout={review.layout} headRows={review.headRows} />
        </div>
      </Disclosure>
    </>
  );
}
