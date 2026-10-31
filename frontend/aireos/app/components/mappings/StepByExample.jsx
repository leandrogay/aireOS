'use client';

import { useState } from 'react';
import { Plus, Sparkles, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import SelectDropdown from '@/components/ui/SelectDropdown';
import { inputClass } from '@/components/inventory/formStyles';
import { suggestSteps } from '@/app/utils/stepByExample';
import { cn } from '@/lib/utils';

const smallButton = 'h-7 border-deep-violet-blue/30 bg-white px-2 text-xs text-deep-violet-blue hover:bg-cream';
const iconButton = 'rounded-md p-1 text-deep-violet-blue/50 hover:bg-cream hover:text-deep-violet-blue disabled:opacity-40';

// Examples a reviewer can give; two settle most readings, three any.
const MAX_EXAMPLES = 3;

// How many of the other values a suggestion shows its result for.
const SHOWN = 4;

/**
 * "Show what a value should become": the reviewer picks one of the column's
 * values, types what it should be, and gets the steps that do exactly that
 * (stepByExample.suggestSteps), each with what it makes of the other values.
 * A second example settles a value that reads more than one way. Using a
 * suggestion adds it as the next step, where it can be changed like any other.
 *
 * @param {{
 *   values: string[],
 *   onAdd: (step: object) => void,
 *   disabled?: boolean,
 * }} props `values` are the column's sample values as they reach a new step.
 */
export default function StepByExample({ values, onAdd, disabled = false }) {
  const [examples, setExamples] = useState(() => [{ before: values[0], after: '' }]);
  const suggestions = suggestSteps(values, examples);
  const typed = examples.every((example) => example.after.trim());
  const unchanged = typed && !suggestions.length;

  function setExample(index, changes) {
    setExamples((prev) => prev.map((example, i) => (i === index ? { ...example, ...changes } : example)));
  }

  function addExample() {
    const used = new Set(examples.map((example) => example.before));
    setExamples((prev) => [...prev, { before: values.find((value) => !used.has(value)) ?? values[0], after: '' }]);
  }

  function use(step) {
    onAdd(step);
    setExamples([{ before: values[0], after: '' }]);
  }

  return (
    <div className="space-y-1.5 rounded-md border border-dashed border-lavander p-2 text-xs text-deep-violet-blue">
      <p className="flex items-center gap-1 font-medium">
        <Sparkles aria-hidden="true" className="size-3.5 text-deep-violet-blue/60" />
        Or show what a value should become
      </p>

      <ul className="space-y-1">
        {examples.map((example, index) => (
          <li key={index} className="flex flex-wrap items-center gap-1.5">
            <div className="min-w-0 flex-1 basis-40">
              <SelectDropdown
                value={example.before}
                onChange={(before) => setExample(index, { before })}
                size="sm"
                ariaLabel={`Example value ${index + 1}`}
                disabled={disabled}
                triggerClassName="font-mono"
                options={values.map((value) => ({ value, label: value }))}
              />
            </div>
            <span aria-hidden="true" className="text-deep-violet-blue/40">
              →
            </span>
            <input
              type="text"
              value={example.after}
              placeholder="becomes…"
              aria-label={`What example ${index + 1} should become`}
              disabled={disabled}
              onChange={(event) => setExample(index, { after: event.target.value })}
              className={cn(inputClass, 'min-w-0 flex-1 basis-32 py-1 font-mono text-xs')}
            />
            {examples.length > 1 && (
              <button
                type="button"
                aria-label={`Remove example ${index + 1}`}
                disabled={disabled}
                onClick={() => setExamples((prev) => prev.filter((_, i) => i !== index))}
                className={iconButton}
              >
                <X aria-hidden="true" className="size-3.5" />
              </button>
            )}
          </li>
        ))}
      </ul>

      {unchanged && <p className="text-[11px] text-deep-violet-blue/60">That is the value as it is: no step needed.</p>}

      {suggestions.length > 0 && (
        <ul className="space-y-1">
          {suggestions.map((suggestion) => (
            <li
              key={JSON.stringify(suggestion.step)}
              className="flex flex-wrap items-center gap-2 rounded-md border border-lavander bg-white px-2 py-1.5"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium">{suggestion.label}</p>
                <p
                  className="truncate font-mono text-[11px] text-deep-violet-blue/70"
                  title={suggestion.outputs.map((output) => output ?? '—').join(' · ')}
                >
                  {suggestion.outputs
                    .slice(0, SHOWN)
                    .map((output) => output ?? '—')
                    .join(' · ')}
                </p>
                {suggestion.missing > 0 && (
                  <p className="text-[11px] text-amber-900">
                    {suggestion.table
                      ? `${suggestion.missing} of ${values.length} values are not in the table yet; add them once it is a step.`
                      : `Gives nothing for ${suggestion.missing} of ${values.length} values.`}
                  </p>
                )}
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={disabled}
                onClick={() => use(suggestion.step)}
                className={smallButton}
              >
                Use this
              </Button>
            </li>
          ))}
        </ul>
      )}

      {typed && suggestions.length > 1 && examples.length < MAX_EXAMPLES && (
        <p className="text-[11px] text-deep-violet-blue/60">
          More than one way fits. Pick by the results, or give another example.
        </p>
      )}
      {examples.length < MAX_EXAMPLES && values.length > examples.length && (
        <button
          type="button"
          disabled={disabled}
          onClick={addExample}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-deep-violet-blue/70 hover:bg-cream disabled:opacity-60"
        >
          <Plus aria-hidden="true" className="size-3" />
          Another example
        </button>
      )}
    </div>
  );
}
