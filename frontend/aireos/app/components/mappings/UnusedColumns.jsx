'use client';

import Disclosure from '@/components/ui/Disclosure';
import SelectDropdown from '@/components/ui/SelectDropdown';
import { MEASURE_FIELDS, fieldLabel, groupChoices, groupOptionLabel } from '@/app/utils/mappingReview';

/**
 * "Ignored columns": what the file has that no field reads, and so is not
 * imported. Named as a choice, not a fault -- most are rightly left out (a
 * claim column, a Total) -- and kept apart from the What's left list, which is
 * what the reviewer must still do. Ignored on purpose is fine; ignored
 * by accident is the mistake this screen exists to catch, so it is listed
 * with its values and can be put to use from here. A group of period or
 * outlet columns is listed once, and offered to the measures, which are the
 * only fields a group can fill.
 *
 * @param {{
 *   rows: object[],
 *   unusedGroups: object[],
 *   mapping: object,
 *   groups: object[],
 *   openFields: { field: string, label: string }[],
 *   onAssign: (field: string, column: string) => void,
 *   onChooseGroup: (field: string, entry: object) => void,
 *   disabled: boolean,
 * }} props
 */
export default function UnusedColumns({ rows, unusedGroups, mapping, groups, openFields, onAssign, onChooseGroup, disabled }) {
  const count = rows.length + unusedGroups.reduce((total, entry) => total + entry.columns.length, 0);
  if (!count) return null;

  return (
    <Disclosure
      className="mt-2 rounded-md border border-lavander"
      summary={
        <>
          Ignored columns ({count})
          <span className="font-normal text-deep-violet-blue/60"> · not imported</span>
        </>
      }
    >
      <ul>
        {unusedGroups.map((entry) => (
          <li
            key={entry.id}
            className="grid gap-2 border-t border-lavander px-2 py-2 sm:grid-cols-[minmax(0,1fr)_14rem] sm:items-center"
          >
            <div className="min-w-0">
              <p className="font-mono text-xs text-deep-violet-blue">{groupOptionLabel(entry)}</p>
              <p className="text-[11px] text-deep-violet-blue/60">Read as one row per {entry.kind === 'period' ? 'period' : 'outlet'}.</p>
            </div>
            {/* An action menu: it keeps saying "Map to…" after a pick. */}
            <SelectDropdown
              value=""
              onChange={(field) => onChooseGroup(field, entry)}
              size="sm"
              placeholder="Map to…"
              ariaLabel={`Map ${entry.label} to a measure`}
              disabled={disabled}
              options={MEASURE_FIELDS.map((field) => {
                const reason = groupChoices(mapping, groups, field).find((choice) => choice.entry.id === entry.id)?.reason;
                return { value: field, label: fieldLabel(field), disabled: Boolean(reason), hint: reason };
              })}
            />
          </li>
        ))}

        {rows.map((row) => (
          <li
            key={row.column}
            className="grid gap-2 border-t border-lavander px-2 py-2 sm:grid-cols-[minmax(0,1fr)_14rem] sm:items-center"
          >
            <div className="min-w-0">
              <p className="font-mono text-xs text-deep-violet-blue">{row.column}</p>
              {row.samples.length > 0 && (
                <p className="truncate font-mono text-[11px] text-deep-violet-blue/60" title={row.samples.join(' · ')}>
                  e.g. {row.samples.slice(0, 3).join(' · ')}
                </p>
              )}
            </div>
            <SelectDropdown
              value=""
              onChange={(field) => onAssign(field, row.column)}
              size="sm"
              placeholder={openFields.length ? 'Map to…' : 'Every field is filled'}
              ariaLabel={`Map ${row.column} to a field`}
              disabled={disabled || !openFields.length}
              options={openFields.map((entry) => ({ value: entry.field, label: entry.label }))}
            />
          </li>
        ))}
      </ul>
    </Disclosure>
  );
}
