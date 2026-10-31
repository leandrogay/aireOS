'use client';

import { ArrowDown, ArrowUp, CircleAlert, Plus, X } from 'lucide-react';

import SelectDropdown from '@/components/ui/SelectDropdown';
import { newStep, runSamples, stepHelp, stepLabel, stepMenu, stepProblem } from '@/app/utils/transformSteps';

import StepSettings from './StepSettings';

const iconButton =
  'rounded-md p-1 text-deep-violet-blue/50 hover:bg-cream hover:text-deep-violet-blue disabled:opacity-40 disabled:hover:bg-transparent';

// How many sample values each step shows its output for.
const STEP_SAMPLES = 3;

/**
 * What the first few sample values are once this step has run, so a step
 * that goes wrong shows itself where it is, not only at the end.
 */
function StepOutput({ samples, steps, index }) {
  if (!samples.length) return null;
  const rows = runSamples(samples.slice(0, STEP_SAMPLES), steps.slice(0, index + 1));
  const values = rows.map((row) => row.after ?? '—').join(' · ');
  const note = rows.find((row) => row.note)?.note;
  return (
    <p className="mt-1 truncate text-[11px] text-deep-violet-blue/60" title={note ? `${values} (${note})` : values}>
      <span className="text-deep-violet-blue/45">After this step: </span>
      <span className="font-mono text-deep-violet-blue">{values}</span>
      {note && <span> · {note}</span>}
    </p>
  );
}

/** The column's sample values before and after the steps, as far as the browser can tell. */
function SampleRun({ samples, steps }) {
  if (!samples.length) {
    return (
      <p className="rounded-md border border-dashed border-lavander px-2 py-3 text-center text-[11px] text-deep-violet-blue/55">
        Choose where the value comes from to see what it becomes.
      </p>
    );
  }
  const rows = runSamples(samples, steps);
  return (
    <div className="rounded-md border border-lavander bg-white">
      <table className="w-full text-left text-[11px] text-deep-violet-blue">
        <thead className="bg-cream/60 text-deep-violet-blue/60">
          <tr>
            <th className="px-2 py-1 font-medium">In the file</th>
            <th className="px-2 py-1 font-medium">Becomes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-t border-lavander align-top">
              <td className="max-w-32 truncate px-2 py-1 font-mono" title={row.before}>
                {row.before}
              </td>
              <td className="max-w-32 px-2 py-1">
                <span className="block truncate font-mono" title={row.after ?? ''}>
                  {row.after ?? '—'}
                </span>
                {row.note && <span className="block text-deep-violet-blue/50">{row.note}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-lavander px-2 py-1 text-[11px] text-deep-violet-blue/50">
        A quick look at a few values. Test the mapping to run it on the whole file.
      </p>
    </div>
  );
}

/**
 * The steps a field's value goes through, in order, each with its settings
 * and what the first sample values are after it: add one (the steps that suit
 * the field first, stepMenu), move it up or down, take it off. The before and
 * after of every sample sits beside the steps, so the result is in view while
 * they are set. A step set up in a way the server will refuse says so, but is
 * kept -- the reviewer decides, and Test shows what happens.
 *
 * @param {{
 *   steps: object[],
 *   onChange: (steps: object[]) => void,
 *   columns: string[],
 *   samples?: string[],
 *   field?: string,
 *   disabled?: boolean,
 * }} props
 */
export default function StepsEditor({ steps, onChange, columns, samples = [], field, disabled = false }) {
  function update(index, step) {
    onChange(steps.map((item, i) => (i === index ? step : item)));
  }

  function move(index, by) {
    const next = [...steps];
    [next[index], next[index + by]] = [next[index + by], next[index]];
    onChange(next);
  }

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_15rem]">
      <div className="min-w-0 space-y-2">
        {steps.length > 0 && (
          <ol className="space-y-1.5">
            {steps.map((step, index) => {
              const problem = stepProblem(step, columns);
              return (
                <li key={index} className="rounded-md border border-lavander bg-white p-2">
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-lavander text-[10px] font-medium text-deep-violet-blue">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-deep-violet-blue">{stepLabel(step.type)}</p>
                      <p className="text-[11px] text-deep-violet-blue/60">{stepHelp(step.type)}</p>
                    </div>
                    <button type="button" aria-label="Move step up" disabled={disabled || index === 0} onClick={() => move(index, -1)} className={iconButton}>
                      <ArrowUp aria-hidden="true" className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label="Move step down"
                      disabled={disabled || index === steps.length - 1}
                      onClick={() => move(index, 1)}
                      className={iconButton}
                    >
                      <ArrowDown aria-hidden="true" className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove step ${index + 1}`}
                      disabled={disabled}
                      onClick={() => onChange(steps.filter((_, i) => i !== index))}
                      className={iconButton}
                    >
                      <X aria-hidden="true" className="size-3.5" />
                    </button>
                  </div>
                  <div className="mt-1.5 pl-6">
                    <StepSettings
                      step={step}
                      columns={columns}
                      onChange={(next) => update(index, next)}
                      disabled={disabled}
                      isCodeTable={field === 'sku' && step.type === 'value_map'}
                    />
                    {problem ? (
                      <p className="mt-1 flex items-center gap-1 text-[11px] text-amber-900">
                        <CircleAlert aria-hidden="true" className="size-3 shrink-0" />
                        {problem}
                      </p>
                    ) : (
                      <StepOutput samples={samples} steps={steps} index={index} />
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        {/* An action menu: it keeps saying "Add a step…" after a pick. */}
        <div className="flex items-center gap-1.5">
          <Plus aria-hidden="true" className="size-3.5 text-deep-violet-blue/60" />
          <div className="w-56">
            <SelectDropdown
              value=""
              onChange={(type) => onChange([...steps, newStep(type)])}
              size="sm"
              placeholder={steps.length ? 'Add another step…' : 'Add a step…'}
              ariaLabel="Add a step"
              disabled={disabled}
              groups={stepMenu(field)}
            />
          </div>
        </div>
      </div>

      {/* First on a narrow screen, beside the steps on a wide one: the result
          stays in view either way. */}
      <div className="order-first space-y-1 lg:sticky lg:top-0 lg:order-none lg:self-start">
        <p className="text-[11px] font-medium text-deep-violet-blue/70">Preview</p>
        <SampleRun samples={samples} steps={steps} />
      </div>
    </div>
  );
}
