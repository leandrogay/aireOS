'use client';

import { Check, CircleAlert, SlidersHorizontal } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { PROPOSER, isMissing, needsConfirm, summariseTransforms } from '@/app/utils/mappingReview';
import { cn } from '@/lib/utils';

import ConfidenceBadge, { confidenceLevel } from '../mappings/ConfidenceBadge';
import ResetButton from '../mappings/ResetButton';

/** Where a field is read from, in a few words. */
function sourceText(entry) {
  if (entry.status === 'unmapped') return 'Nothing yet';
  if (entry.status === 'not_available') return 'Not in this file';
  if (entry.groupId) return `A group of columns like “${entry.column}”`;
  if (entry.status === 'mapped') return `Column “${entry.column}”`;
  return entry.description;
}

/**
 * The tick on a field card. Ticked means "looks right": a confident field
 * starts ticked, a low-confidence guess starts unticked and is ticked by the
 * reviewer. Unticking a field opens its editor, since saying "not right" is
 * the start of choosing another source -- except a tick given on this visit,
 * which is simply taken back.
 */
function Tick({ entry, canUndo, onConfirm, onUndo, onChange, disabled }) {
  if (isMissing(entry)) {
    return (
      <span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-amber-500 bg-amber-50 text-amber-700">
        <CircleAlert aria-hidden="true" className="size-4" />
      </span>
    );
  }

  const ticked = !needsConfirm(entry);
  let label = `${entry.label} looks right`;
  let onClick = () => onConfirm(entry);
  if (ticked && canUndo) {
    label = `Untick ${entry.label}`;
    onClick = () => onUndo(entry);
  } else if (ticked) {
    label = `${entry.label} isn't right: change it`;
    onClick = () => onChange(entry);
  }

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={ticked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex size-6 shrink-0 items-center justify-center rounded-md border transition focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-violet/40',
        ticked
          ? 'border-deep-violet-blue bg-deep-violet-blue text-white hover:bg-deep-violet-blue/85'
          : 'border-amber-600 bg-white text-transparent hover:text-amber-700',
      )}
    >
      <Check aria-hidden="true" className="size-4" strokeWidth={3} />
    </button>
  );
}

/**
 * One field as a card: the tick, what the field is, where it is read from with
 * a few of its values, how sure the AI was when it was not sure, and Change
 * (the full field editor: another column, a group, the headings, the title's
 * period, units × price, a fixed value, steps on the value). `picker` adds a
 * quick column choice under it, for a field nothing fills yet.
 *
 * @param {{
 *   entry: object,
 *   canUndo: boolean,
 *   canReset: boolean,
 *   onConfirm: (entry: object) => void,
 *   onUndo: (entry: object) => void,
 *   onChange: (entry: object) => void,
 *   onReset: () => void,
 *   picker?: import('react').ReactNode,
 *   disabled: boolean,
 * }} props
 */
export default function FieldCard({ entry, canUndo, canReset, onConfirm, onUndo, onChange, onReset, picker, disabled }) {
  const missing = isMissing(entry);
  const unsure = needsConfirm(entry);
  const level = confidenceLevel(entry);
  const changes = entry.transform && entry.status !== 'auto' ? summariseTransforms(entry.transform) : [];

  return (
    <li
      className={cn(
        'flex items-start gap-3 rounded-lg border p-3',
        missing ? 'border-amber-300 bg-amber-50' : unsure ? 'border-amber-300 bg-white' : 'border-lavander bg-white',
      )}
    >
      <Tick entry={entry} canUndo={canUndo} onConfirm={onConfirm} onUndo={onUndo} onChange={onChange} disabled={disabled} />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-sm font-medium text-deep-violet-blue">
            {entry.label}
            {entry.required && (
              <span aria-label="Required" title="Required" className="text-red-700">
                {' '}
                *
              </span>
            )}
          </p>
          {entry.status !== 'unmapped' && level !== 'high' && <ConfidenceBadge level={level} />}
        </div>
        <p className="text-sm text-deep-violet-blue">{sourceText(entry)}</p>
        {entry.samples?.length > 0 && (
          <p className="truncate font-mono text-xs text-deep-violet-blue/80" title={entry.samples.join(' · ')}>
            {entry.samples.slice(0, 3).join(' · ')}
          </p>
        )}
        {changes.length > 0 && (
          <p className="truncate text-xs text-deep-violet-blue/80" title={changes.join('; ')}>
            Then: {changes.join('; ')}
          </p>
        )}
        {unsure && entry.rationale && (
          <p className="mt-1 text-xs text-amber-900">
            {PROPOSER}: “{entry.rationale}”
          </p>
        )}
        {missing && <p className="mt-1 text-xs text-amber-900">{entry.help || 'Required — choose where it comes from.'}</p>}
        {picker && <div className="mt-2">{picker}</div>}
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => onChange(entry)}
          aria-label={`Change how ${entry.label} is filled`}
        >
          <SlidersHorizontal aria-hidden="true" />
          {missing ? 'More ways' : 'Change'}
        </Button>
        {canReset && (
          <ResetButton
            label={`Reset ${entry.label} to the ${PROPOSER}'s proposal`}
            text="Undo"
            onClick={onReset}
            disabled={disabled}
            className="text-deep-violet-blue"
          />
        )}
      </div>
    </li>
  );
}
