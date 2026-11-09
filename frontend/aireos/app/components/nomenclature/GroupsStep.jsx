'use client';

import { ArrowDown, CheckCircle2, SlidersHorizontal } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  MEASURE_FIELDS,
  fieldLabel,
  groupChoices,
  groupOptionLabel,
  needsConfirm,
  periodLabel,
} from '@/app/utils/mappingReview';

import ColumnGroupDetails from '../mappings/ColumnGroupDetails';

// How many headings the before/after example shows.
const EXAMPLE = 3;

/**
 * The idea of a column group in one picture: several columns side by side in
 * the file become rows, one per heading, each heading read as a period (or an
 * outlet). Drawn from the readings the backend made of this file's own
 * headings (mapping_view.column_groups), so it is this file, not an example.
 */
function BeforeAfter({ group, entry }) {
  const isPeriod = group.settings.key?.target === 'period_start';
  const periodType = group.settings.period_type;
  const readings = (entry?.readings || []).slice(0, EXAMPLE);
  const columns = group.columns.slice(0, EXAMPLE);
  const cell = 'max-w-36 truncate whitespace-nowrap px-2 py-1.5';
  if (!columns.length) return null;
  const rows = readings.length ? readings : columns.map((column) => ({ column, readsAs: column }));

  return (
    <div className="space-y-1.5 text-xs text-deep-violet-blue">
      <div className="overflow-hidden rounded-md border border-lavander">
        <p className="bg-cream/40 px-2 py-1.5 font-medium">In the file: one column each</p>
        <div className="overflow-x-auto">
          <table className="w-full font-mono">
            <tbody>
              <tr className="border-t border-lavander bg-lavander">
                {columns.map((column) => (
                  <td key={column} className={cell} title={column}>
                    {column}
                  </td>
                ))}
                {group.columns.length > EXAMPLE && <td className="px-2 py-1.5">+{group.columns.length - EXAMPLE} more</td>}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <ArrowDown aria-hidden="true" className="mx-auto size-4" />

      <div className="overflow-hidden rounded-md border border-lavander">
        <p className="bg-cream/40 px-2 py-1.5 font-medium">Loaded: one row each</p>
        <table className="w-full">
          <thead className="sr-only">
            <tr>
              <th>{isPeriod ? 'Period' : 'Heading'}</th>
              <th>Example value</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((reading) => (
              <tr key={reading.column} className="border-t border-lavander">
                <td className={`${cell} font-medium`}>{isPeriod ? periodLabel(reading.readsAs, periodType) : reading.readsAs}</td>
                <td className={`${cell} font-mono`}>{reading.sample ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * "Some columns repeat": a file with a column per month (or per outlet) is
 * read as one row per heading. Each group in use is shown as a before → after
 * picture of this file beside its settings (which columns, how a heading
 * reads) and a "Looks right" for a group the AI was unsure of. A group
 * nothing uses is offered to the measures.
 *
 * @param {{
 *   review: ReturnType<import('@/hooks/useGuidedReview').default>,
 *   mapping: object,
 *   onEdit: (entry: object) => void,
 *   disabled: boolean,
 * }} props
 */
export default function GroupsStep({ review, mapping, onEdit, disabled }) {
  const { edits, issues } = review;

  return (
    <>
      {edits.groups.map((group) => {
        const coverageEntry = issues.coverage.find((entry) => entry.groupId === group.id);
        const columnEntry = (mapping.columnGroups || []).find((item) => item.id === group.entryId) || null;
        const isPeriod = group.settings.key?.target === 'period_start';
        const unsure = coverageEntry && needsConfirm(coverageEntry);

        return (
          <section key={group.id} className="rounded-lg border border-lavander">
            <div className="flex flex-wrap items-start justify-between gap-2 border-b border-lavander px-3 py-2.5">
              <div>
                <p className="text-sm font-medium text-deep-violet-blue">{fieldLabel(group.field)}</p>
                <p className="text-sm text-deep-violet-blue/80">
                  Read from {group.columns.length} columns, one row per{' '}
                  {isPeriod ? (group.settings.period_type === 'week' ? 'week' : 'month') : 'outlet'}.
                </p>
              </div>
              {coverageEntry && (
                <Button type="button" variant="outline" size="sm" onClick={() => onEdit(coverageEntry)} disabled={disabled}>
                  <SlidersHorizontal aria-hidden="true" />
                  Change
                </Button>
              )}
            </div>

            <div className="grid gap-4 p-3 lg:grid-cols-2">
              <BeforeAfter group={group} entry={columnEntry} />

              <div className="space-y-3">
                <ColumnGroupDetails
                  group={group}
                  entry={columnEntry}
                  columns={mapping.columns || []}
                  onSettingsChange={edits.changeGroupSettings}
                  disabled={disabled}
                />

                {unsure ? (
                  <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2">
                    <p className="text-sm text-amber-900">
                      The AI wasn’t sure about these columns. Does the picture match the file?
                    </p>
                    <Button type="button" variant="outline" size="sm" onClick={() => edits.confirmField(coverageEntry)} disabled={disabled}>
                      <CheckCircle2 aria-hidden="true" />
                      Looks right
                    </Button>
                  </div>
                ) : (
                  <p className="flex items-center gap-1.5 text-sm text-green-800">
                    <CheckCircle2 aria-hidden="true" className="size-4" />
                    Looks right
                  </p>
                )}
              </div>
            </div>
          </section>
        );
      })}

      {issues.unusedGroups.map((entry) => (
        <section
          key={entry.id}
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-deep-violet-blue/40 px-3 py-2.5"
        >
          <div className="min-w-0">
            <p className="text-sm font-medium text-deep-violet-blue">Not used yet: {groupOptionLabel(entry)}</p>
            <p className="text-sm text-deep-violet-blue/80">
              These repeat by {entry.kind === 'period' ? 'period' : 'outlet'}, but nothing reads them, so they are not imported.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {MEASURE_FIELDS.map((field) => {
              const reason = groupChoices(mapping, edits.groups, field).find((choice) => choice.entry.id === entry.id)?.reason;
              return (
                <Button
                  key={field}
                  type="button"
                  variant="outline"
                  size="sm"
                  title={reason || undefined}
                  disabled={disabled || Boolean(reason)}
                  onClick={() => edits.chooseGroup(field, entry)}
                >
                  Use for {fieldLabel(field)}
                </Button>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}
