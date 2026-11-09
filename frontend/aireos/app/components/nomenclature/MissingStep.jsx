'use client';

import { useState } from 'react';

import SelectDropdown from '@/components/ui/SelectDropdown';
import { fieldLabel, isMissing } from '@/app/utils/mappingReview';

import FieldCard from './FieldCard';

/**
 * The quick way to fill a missing field: pick a column. Columns nothing reads
 * come first; one already in use can fill this field too. Every other way
 * (a group, the headings, the title's period, units × price, a fixed value)
 * is behind the card's "More ways".
 */
function ColumnPicker({ entry, rows, groups, onAssign, disabled }) {
  const inGroups = new Set(groups.flatMap((group) => group.columns));
  const assignable = rows.filter((row) => !inGroups.has(row.column));
  const free = assignable.filter((row) => !row.fields.length);
  const taken = assignable.filter((row) => row.fields.length);

  return (
    <SelectDropdown
      value=""
      onChange={(column) => column && onAssign(entry.field, column)}
      size="sm"
      searchable={assignable.length > 8}
      searchPlaceholder="Search columns…"
      placeholder="Pick a column…"
      ariaLabel={`Column for ${entry.label}`}
      disabled={disabled || !assignable.length}
      className="sm:w-72"
      groups={[
        { label: 'Columns not used yet', options: free.map((row) => ({ value: row.column, label: row.column })) },
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

/**
 * "Fill in what's missing": each required field nothing fills, one card each,
 * with a column picker and the full editor. A filled card stays on screen,
 * ticked, so the reviewer sees what they did.
 *
 * @param {{
 *   review: ReturnType<import('@/hooks/useGuidedReview').default>,
 *   onEdit: (entry: object) => void,
 *   disabled: boolean,
 * }} props
 */
export default function MissingStep({ review, onEdit, disabled }) {
  const { edits, issues } = review;
  const [fields] = useState(() => issues.missingRequired.map((entry) => entry.field));
  const byField = new Map(issues.coverage.map((entry) => [entry.field, entry]));

  return (
    <ul className="grid gap-2 xl:grid-cols-2">
      {fields
        .map((field) => byField.get(field))
        .filter(Boolean)
        .map((entry) => (
          <FieldCard
            key={entry.field}
            entry={entry}
            canUndo={edits.confirmedNow.has(entry.field)}
            canReset={edits.canResetFields([entry.field])}
            onConfirm={edits.confirmField}
            onUndo={edits.undoConfirm}
            onChange={onEdit}
            onReset={() => edits.resetFields([entry.field])}
            picker={
              isMissing(entry) && (
                <ColumnPicker entry={entry} rows={edits.rows} groups={edits.groups} onAssign={edits.assignColumn} disabled={disabled} />
              )
            }
            disabled={disabled}
          />
        ))}
    </ul>
  );
}
