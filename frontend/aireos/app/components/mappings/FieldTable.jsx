'use client';

import { CheckCircle2, CircleAlert, SlidersHorizontal } from 'lucide-react';

import InfoTooltip from '@/components/ui/InfoTooltip';
import SelectDropdown from '@/components/ui/SelectDropdown';
import Disclosure from '@/components/ui/Disclosure';
import {
  MEASURE_FIELDS,
  PROPOSER,
  fieldLabel,
  groupChoices,
  groupOptionLabel,
  isMissing,
  needsConfirm,
  summariseTransforms,
} from '@/app/utils/mappingReview';
import { cn } from '@/lib/utils';

import ColumnGroupDetails from './ColumnGroupDetails';
import ConfidenceBadge, { confidenceLevel } from './ConfidenceBadge';
import ResetButton from './ResetButton';

const smallButton =
  'shrink-0 rounded-md border border-deep-violet-blue bg-white px-2 py-1 text-[11px] font-medium text-deep-violet-blue transition hover:bg-lavander focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-deep-violet-blue disabled:opacity-60';

const GROUP_PREFIX = 'group:';

/**
 * Where one field is read from. Any field can take a column: those filling
 * nothing first, but one already filling a field is just as valid -- a
 * description column can carry the product name and the size -- so picking it
 * adds to what it does. A measure can also take a column group, one row per
 * period or outlet; a group's columns are its own while it is in use.
 */
function SourcePicker({ entry, rows, mapping, groups, onAssign, onChooseGroup, onClear, disabled }) {
  const inGroups = new Set(groups.flatMap((group) => group.columns));
  const assignable = rows.filter((row) => !inGroups.has(row.column));
  const free = assignable.filter((row) => !row.fields.length);
  const taken = assignable.filter((row) => row.fields.length && row.column !== entry.column);
  const activeGroup = groups.find((group) => group.id === entry.groupId);
  const choices = MEASURE_FIELDS.includes(entry.field) ? groupChoices(mapping, groups, entry.field) : [];

  let current = '';
  if (activeGroup) current = `${GROUP_PREFIX}${activeGroup.entryId}`;
  else if (entry.status === 'mapped') current = entry.column;

  function handleChange(value) {
    if (value.startsWith(GROUP_PREFIX)) {
      const choice = choices.find((item) => item.entry.id === value.slice(GROUP_PREFIX.length));
      if (choice) onChooseGroup(entry.field, choice.entry);
    } else if (value) onAssign(entry.field, value);
    else if (current) onClear(entry.field);
  }

  return (
    <SelectDropdown
      value={current}
      onChange={handleChange}
      size="sm"
      searchable={assignable.length > 8}
      searchPlaceholder="Search columns…"
      placeholder="Choose a column…"
      ariaLabel={`Source for ${entry.label}`}
      disabled={disabled || (!assignable.length && !choices.length)}
      triggerClassName={cn(isMissing(entry) && 'border-amber-400 bg-white')}
      groups={[
        {
          options: current
            ? [
                { value: '', label: 'Not in this file' },
                ...(activeGroup ? [] : [{ value: current, label: current }]),
              ]
            : [],
        },
        {
          label: 'Column groups (one row per period or outlet)',
          options: choices.map(({ entry: group, reason }) => ({
            value: `${GROUP_PREFIX}${group.id}`,
            label: groupOptionLabel(group),
            disabled: Boolean(reason),
            hint: reason,
          })),
        },
        {
          label: 'Columns not used yet',
          options: free.map((row) => ({ value: row.column, label: row.column })),
        },
        {
          label: 'Columns already used (adds to them)',
          options: taken.map((row) => ({
            value: row.column,
            label: row.column,
            hint: `→ ${row.fields.map((field) => fieldLabel(field.targetField)).join(', ')}`,
          })),
        },
      ]}
    />
  );
}

/** Where a field is read from, in a few words, for its info card. */
function sourceText(entry) {
  if (entry.status === 'unmapped') return 'Nothing yet';
  if (entry.status === 'not_available') return 'Not in this file';
  if (entry.groupId) return `A group of columns like “${entry.column}”`;
  if (entry.status === 'mapped') return `Column “${entry.column}”`;
  return entry.description;
}

/**
 * Everything about a field that is worth knowing but not worth a line on
 * screen, as a small labelled card: what belongs in it, where it is read
 * from, what is done to the value, how sure the AI was and why, and the name
 * it is stored under (which the checks quote).
 */
function FieldInfo({ entry }) {
  const changes = entry.transform ? summariseTransforms(entry.transform) : [];
  const level = confidenceLevel(entry);
  const reason = level !== 'reviewer' ? entry.rationale : '';

  return (
    <InfoTooltip label={`About ${entry.label}`} className="w-80">
      <p className="text-sm font-medium text-deep-violet-blue">{entry.label}</p>
      <p>{entry.help}</p>

      <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-2 gap-y-1.5 border-t border-lavander pt-2">
        <dt className="text-deep-violet-blue/60">Read from</dt>
        <dd className="text-deep-violet-blue">{sourceText(entry)}</dd>

        {entry.status === 'not_available' && entry.reason && (
          <>
            <dt className="text-deep-violet-blue/60">Why not</dt>
            <dd className="text-deep-violet-blue">{entry.reason}</dd>
          </>
        )}

        {changes.length > 0 && (
          <>
            <dt className="text-deep-violet-blue/60">Changes</dt>
            <dd className="space-y-0.5 text-deep-violet-blue">
              {changes.map((change) => (
                <p key={change} className="break-words">
                  {change}
                </p>
              ))}
              {entry.field === 'sku' && <p className="text-deep-violet-blue/60">The full list is under Product codes.</p>}
            </dd>
          </>
        )}

        {entry.status !== 'unmapped' && (
          <>
            <dt className="text-deep-violet-blue/60">Confidence</dt>
            <dd>
              <ConfidenceBadge level={level} />
            </dd>
          </>
        )}

        {reason && (
          <>
            <dt className="text-deep-violet-blue/60">{PROPOSER}&apos;s reason</dt>
            <dd className="text-deep-violet-blue">{reason}</dd>
          </>
        )}

        <dt className="text-deep-violet-blue/60">Stored as</dt>
        <dd className="font-mono text-[11px] text-deep-violet-blue">{entry.field}</dd>
      </dl>
    </InfoTooltip>
  );
}

/**
 * How sure the AI was, shown on the fields it was not sure of, and the sign-off on a
 * low-confidence guess: "Looks right", then "Confirmed" (with Undo on this
 * visit). A field the reviewer changed -- or cleared -- also offers Reset,
 * back to what the AI proposed.
 */
function Confidence({ entry, canUndo, onConfirm, onUndo, canReset, onReset, disabled }) {
  const filled = entry.status !== 'unmapped';
  const level = confidenceLevel(entry);
  const guessed = filled && entry.confidence === 'low' && level !== 'reviewer';

  return (
    <div className="flex flex-wrap items-center gap-1.5 sm:flex-col sm:items-end">
      {/* Only the fields that need a look are badged: a green "High" on every
          row became background and read as approval. High stays in the ⓘ card. */}
      {filled && level !== 'high' && <ConfidenceBadge level={level} />}
      {guessed && !entry.reviewed && (
        <button type="button" disabled={disabled} onClick={() => onConfirm(entry)} className={smallButton}>
          Looks right
        </button>
      )}
      {guessed && entry.reviewed && (
        <span className="flex items-center gap-1.5 text-[11px]">
          <span className="flex items-center gap-1 font-medium text-green-700">
            <CheckCircle2 aria-hidden="true" className="size-3 shrink-0" />
            Confirmed
          </span>
          {canUndo && !disabled && (
            <button
              type="button"
              // Mounted only by a click on "Looks right", so taking focus follows
              // the reviewer's action instead of interrupting a page load.
              autoFocus
              onClick={() => onUndo(entry)}
              className="font-medium text-deep-violet-blue/70 underline-offset-2 hover:underline"
            >
              Undo
            </button>
          )}
        </span>
      )}
      {canReset && (
        <ResetButton
          label={`Reset ${entry.label} to the ${PROPOSER}'s proposal`}
          onClick={onReset}
          disabled={disabled}
        />
      )}
    </div>
  );
}

function FieldRow({
  entry,
  mapping,
  rows,
  groups,
  canUndo,
  canResetField,
  onResetField,
  onAssign,
  onChooseGroup,
  onClear,
  onConfirm,
  onUndo,
  onGroupSettingsChange,
  onEdit,
  disabled,
}) {
  // The retailer is reset in step 1, where it is changed.
  const canReset = entry.field !== 'retailer' && canResetField(entry.field);
  const missing = isMissing(entry);
  const unsure = needsConfirm(entry);
  const group = groups.find((item) => item.id === entry.groupId);
  // A field filled without a column says how instead of offering columns:
  // the retailer is changed in step 1, the headings' fields follow their group.
  const picker = entry.status !== 'auto';

  return (
    <li
      className={cn(
        'grid items-start gap-1.5 border-t border-lavander px-2 py-2 first:border-t-0 sm:grid-cols-[10rem_minmax(0,1fr)_9.5rem] sm:gap-3',
        missing && 'bg-amber-50',
        !missing && unsure && 'bg-amber-50/50',
      )}
    >
      <div className="flex min-w-0 items-center gap-1 pt-1">
        <span className="truncate text-xs font-medium text-deep-violet-blue">{entry.label}</span>
        {entry.required && (
          <span aria-label="Required" title="Required" className="text-red-700">
            *
          </span>
        )}
        <FieldInfo entry={entry} />
      </div>

      <div className="min-w-0 space-y-1">
        <div className="flex items-start gap-1.5">
          <div className="min-w-0 flex-1">
            {picker ? (
              <SourcePicker
                entry={entry}
                rows={rows}
                mapping={mapping}
                groups={groups}
                onAssign={onAssign}
                onChooseGroup={onChooseGroup}
                onClear={onClear}
                disabled={disabled}
              />
            ) : (
              <p className="pt-1 text-xs text-deep-violet-blue">
                {entry.description}
                {entry.field === 'retailer' && <span className="text-deep-violet-blue/60"> · its retailers are set in step 1</span>}
              </p>
            )}
          </div>
          {/* Every way the field can be filled, and the steps on its value;
              the dropdown beside it is the quick way to pick a column. */}
          <button
            type="button"
            disabled={disabled}
            onClick={() => onEdit(entry)}
            aria-label={`Edit how ${entry.label} is filled`}
            title={`Edit how ${entry.label} is filled`}
            className={cn(smallButton, 'inline-flex items-center gap-1')}
          >
            <SlidersHorizontal aria-hidden="true" className="size-3" />
            Edit
          </button>
        </div>
        {entry.transform && entry.status !== 'auto' && (
          <p className="truncate text-[11px] text-deep-violet-blue/60" title={summariseTransforms(entry.transform).join('; ')}>
            Then: {summariseTransforms(entry.transform).join('; ')}
          </p>
        )}
        {group && (
          <ColumnGroupDetails
            group={group}
            entry={(mapping.columnGroups || []).find((item) => item.id === group.entryId) || null}
            columns={mapping.columns || []}
            onSettingsChange={onGroupSettingsChange}
            disabled={disabled}
          />
        )}
        {missing && (
          <p className="flex items-center gap-1 text-[11px] text-amber-900">
            <CircleAlert aria-hidden="true" className="size-3 shrink-0" />
            Required — choose where it comes from
          </p>
        )}
        {entry.samples?.length > 0 && (
          <p className="truncate font-mono text-[11px] text-deep-violet-blue/50" title={entry.samples.join(' · ')}>
            {entry.samples.slice(0, 3).join(' · ')}
          </p>
        )}
      </div>

      <Confidence
        entry={entry}
        canUndo={canUndo}
        onConfirm={onConfirm}
        onUndo={onUndo}
        canReset={canReset}
        onReset={() => onResetField(entry.field)}
        disabled={disabled}
      />
    </li>
  );
}

/**
 * Step 2: every field of the sell-out data and where this mapping reads it
 * from. A field is changed by choosing its source: a column, or for a measure
 * a column group read one row per period or outlet -- or, through Edit, any
 * other way the backend can fill it, with steps applied to the value. A
 * low-confidence guess is signed off with "Looks right". The details of each
 * field are behind its info icon.
 *
 * Required fields are always shown. Optional ones are folded away unless one
 * of them needs the reviewer, and the fields the pipeline always fills itself
 * are named at the foot of them.
 *
 * @param {{
 *   coverage: object[],
 *   mapping: object,
 *   rows: object[],
 *   groups: object[],
 *   confirmedNow: Set<string>,
 *   onAssign: (field: string, column: string) => void,
 *   onChooseGroup: (field: string, entry: object) => void,
 *   onClear: (field: string) => void,
 *   onConfirm: (entry: object) => void,
 *   onUndo: (entry: object) => void,
 *   onGroupSettingsChange: (groupId: string, changes: object) => void,
 *   onEdit: (entry: object) => void,
 *   canResetField: (field: string) => boolean,
 *   onResetField: (field: string) => void,
 *   disabled: boolean,
 * }} props
 */
export default function FieldTable({ coverage, confirmedNow, ...props }) {
  const decidable = coverage.filter((entry) => entry.decidable);
  const required = decidable.filter((entry) => entry.required);
  const optional = decidable.filter((entry) => !entry.required);
  const automatic = coverage.filter((entry) => !entry.decidable);
  const optionalFilled = optional.filter((entry) => entry.status === 'mapped' || entry.status === 'auto').length;
  const optionalNeedsYou = optional.some(needsConfirm);

  const renderRows = (entries) => (
    <ul>
      {entries.map((entry) => (
        <FieldRow key={entry.field} entry={entry} canUndo={confirmedNow.has(entry.field)} {...props} />
      ))}
    </ul>
  );

  return (
    <div className="space-y-2">
      <div className="rounded-md border border-lavander">{renderRows(required)}</div>

      <Disclosure
        open={optionalNeedsYou}
        className="rounded-md border border-lavander"
        summary={
          <>
            Optional fields
            <span className="font-normal text-deep-violet-blue/60">
              {' '}
              · {optionalFilled} of {optional.length} filled
              {optionalNeedsYou && ' · some need you'}
            </span>
          </>
        }
      >
        <div className="border-t border-lavander">{renderRows(optional)}</div>
        {automatic.length > 0 && (
          <p className="border-t border-lavander px-2 py-1.5 text-[11px] text-deep-violet-blue/60">
            Filled automatically: {automatic.map((entry) => entry.label).join(', ')}.
          </p>
        )}
      </Disclosure>
    </div>
  );
}
