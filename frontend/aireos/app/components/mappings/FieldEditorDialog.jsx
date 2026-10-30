'use client';

import { useState } from 'react';
import { CircleAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { primaryButtonClass, secondaryButtonClass } from '@/components/inventory/formStyles';
import {
  currentDecision,
  decisionProblem,
  decisionSummary,
  dependentFields,
  fieldMethods,
  rowsAboveChoices,
} from '@/app/utils/fieldDecision';
import { fieldLabel } from '@/app/utils/mappingReview';
import { cn } from '@/lib/utils';

import FieldMethodSettings from './FieldMethodSettings';

// Problems that leave nothing to apply. Anything else (a step the server
// will refuse, a title with no period in this file) is said, not enforced.
const BLOCKING = new Set(['column', 'group', 'price', 'constant', 'derived']);

/**
 * A starting draft for every method, so switching between them keeps what
 * was set in each: the field's current decision for its own method, and a
 * sensible empty one for the rest.
 */
function startingDrafts(field, current, { groups, layout, columns }) {
  const firstRow = rowsAboveChoices(layout, groups[0]?.columns || [])[0];
  const priceGuess = columns.find((column) => /promo.*(cost|price)/i.test(column)) || columns.find((column) => /price|cost/i.test(column));
  const drafts = {
    column: { method: 'column', column: '', transforms: [] },
    group: { method: 'group', entryId: '', transforms: [] },
    headings: { method: 'headings' },
    above: { method: 'above', rowsAbove: firstRow?.rowsAbove || 1 },
    title: { method: 'title' },
    price: { method: 'price', column: priceGuess || '' },
    constant: { method: 'constant', value: field === 'period_type' ? 'month' : '' },
    derived: { method: 'derived', fromField: '', transforms: [] },
    not_available: { method: 'not_available', reason: '' },
  };
  if (drafts[current.method]) drafts[current.method] = { ...drafts[current.method], ...current };
  return drafts;
}

function EditorForm({ entry, mapping, state, layout, onApply, onClose }) {
  const field = entry.field;
  const current = currentDecision(mapping, state, field);
  const methods = fieldMethods(field, state.groups);
  const [drafts, setDrafts] = useState(() =>
    startingDrafts(field, current, { groups: state.groups, layout, columns: mapping.columns || [] }),
  );
  const [method, setMethod] = useState(() =>
    methods.some((item) => item.method === current.method) ? current.method : 'column',
  );

  const draft = drafts[method];
  const dependents = method !== current.method ? dependentFields(mapping, state, field) : [];
  const problem = decisionProblem(field, draft, { stated: Boolean(layout?.stated_period) });
  const blocked = Boolean(problem) && BLOCKING.has(method);

  function handleSubmit(event) {
    event.preventDefault();
    if (blocked) return;
    onApply(field, draft);
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="flex max-h-[85vh] flex-col rounded-lg border border-lavander bg-white shadow-sm">
      <div className="border-b border-lavander py-3 pl-4 pr-12">
        <h2 className="font-serif text-xl text-deep-violet-blue">How is {entry.label} filled?</h2>
        <p className="mt-0.5 text-xs text-deep-violet-blue/65">
          {entry.help} <span className="text-deep-violet-blue/45">Now: {decisionSummary(current)}.</span>
        </p>
      </div>

      <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto px-4 py-3 sm:grid-cols-[14rem_minmax(0,1fr)]">
        <fieldset className="min-w-0">
          <legend className="sr-only">Ways to fill {entry.label}</legend>
          <ul className="space-y-1">
            {methods.map((item) => (
              <li key={item.method}>
                <label
                  className={cn(
                    'flex cursor-pointer items-start gap-2 rounded-md border px-2 py-1.5 text-xs text-deep-violet-blue',
                    method === item.method ? 'border-deep-violet-blue bg-lavander/40' : 'border-lavander hover:bg-cream/60',
                    item.reason && 'cursor-not-allowed opacity-60',
                  )}
                  title={item.reason || item.help}
                >
                  <input
                    type="radio"
                    name="method"
                    value={item.method}
                    checked={method === item.method}
                    disabled={Boolean(item.reason)}
                    onChange={() => setMethod(item.method)}
                    className="mt-0.5 size-3.5 accent-deep-violet-blue"
                  />
                  <span>
                    <span className="font-medium">{item.label}</span>
                    {item.reason && <span className="block text-[11px] text-deep-violet-blue/60">{item.reason}</span>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>

        <div className="min-w-0 space-y-2">
          <p className="text-[11px] text-deep-violet-blue/70">{methods.find((item) => item.method === method)?.help}</p>
          <FieldMethodSettings
            field={field}
            method={method}
            draft={draft}
            onChange={(next) => setDrafts((prev) => ({ ...prev, [method]: next }))}
            mapping={mapping}
            rows={state.rows}
            groups={state.groups}
            layout={layout}
          />
          {dependents.length > 0 && (
            <p className="rounded-md bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900">
              {dependents.map(fieldLabel).join(', ')} {dependents.length === 1 ? 'is' : 'are'} worked out from{' '}
              {entry.label}. If its values change (codes instead of names, say), check{' '}
              {dependents.length === 1 ? 'its' : 'their'} rules too.
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 rounded-b-lg border-t border-lavander bg-cream/40 px-4 py-3">
        {problem && (
          <p className={cn('mr-auto flex items-center gap-1 text-xs', blocked ? 'text-red-700' : 'text-amber-900')}>
            <CircleAlert aria-hidden="true" className="size-3.5 shrink-0" />
            {problem}
          </p>
        )}
        <Button type="button" variant="outline" onClick={onClose} className={secondaryButtonClass}>
          Cancel
        </Button>
        <Button type="submit" disabled={blocked} className={primaryButtonClass}>
          Use this
        </Button>
      </div>
    </form>
  );
}

/**
 * Every way the backend can fill one field, for the reviewer to choose from:
 * a column (with steps applied to its value), a group of period or outlet
 * columns, the groups' headings or a row above them, the period the title
 * states, units × a price column, a fixed value, worked out from another
 * field, or not in this file with a reason. Applying it is the reviewer
 * deciding the field; Test then shows what it does to the whole file.
 *
 * @param {{
 *   entry: object | null,
 *   mapping: object,
 *   state: { rows: object[], groups: object[], fieldEdits: object },
 *   layout: object,
 *   onApply: (field: string, decision: object) => void,
 *   onClose: () => void,
 * }} props
 */
export default function FieldEditorDialog({ entry, mapping, state, layout, onApply, onClose }) {
  return (
    <Dialog
      open={Boolean(entry)}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent aria-label={entry ? `How ${entry.label} is filled` : 'Field'} className="bg-transparent p-0 ring-0 sm:max-w-3xl">
        {entry && (
          <EditorForm
            key={entry.field}
            entry={entry}
            mapping={mapping}
            state={state}
            layout={layout}
            onApply={onApply}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
