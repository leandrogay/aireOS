'use client';

import { inputClass } from '@/components/inventory/formStyles';
import Disclosure from '@/components/ui/Disclosure';
import SelectDropdown from '@/components/ui/SelectDropdown';
import { fieldLabel, periodLabel } from '@/app/utils/mappingReview';
import { cn } from '@/lib/utils';

const LAST_COLUMN = '';
const STORE_KEYS = ['store_code', 'store_name'];

/**
 * A group of period (or outlet) columns read as one: how many, the periods it
 * covers, and how its first headings read -- "SALES | Month 1 | 01-01-2026 →
 * Jan 2026" -- so a wrong date format shows before anything is run. The
 * readings come from the backend (mapping_view.column_groups), which parses
 * the headings exactly as the transformation will.
 *
 * One line is always shown -- how many columns, which periods. How the
 * headings read and the group's settings are folded under Details: the
 * columns it takes (a pattern, or every column between two others), how a
 * period heading is read and whether it is a month or a week. Which store
 * fields an outlet heading fills is set on those fields (Edit). What changed
 * settings pick is only known once the checks run.
 *
 * @param {{
 *   group: object,
 *   entry: object | null,
 *   columns: string[],
 *   onSettingsChange: (groupId: string, changes: object) => void,
 *   disabled: boolean,
 * }} props
 */
export default function ColumnGroupDetails({ group, entry, columns, onSettingsChange, disabled }) {
  const periodType = group.settings.period_type;
  const isPeriod = group.settings.key?.target === 'period_start';
  const readings = entry?.readings || [];
  // Which columns it takes and how a heading is read. What the headings fill
  // (store code or name) is not a change to how they are read.
  const readSettings = (settings) =>
    JSON.stringify({
      select: settings.select,
      pattern: settings.key?.pattern,
      format: settings.key?.date_format,
      type: settings.period_type,
    });
  const edited = entry && readSettings(entry.group) !== readSettings(group.settings);
  const select = group.settings.select || {};
  const labels = group.settings.labels || [];

  function setSelect(changes) {
    onSettingsChange(group.id, { select: { ...select, ...changes } });
  }

  return (
    <div className="rounded-md bg-cream/60 px-2 py-1.5">
      <p className="text-[11px] text-deep-violet-blue">
        One row per {isPeriod ? (periodType === 'week' ? 'week' : 'month') : STORE_KEYS.includes(group.settings.key?.target) ? 'outlet' : 'heading'} from{' '}
        <span className="font-medium">{group.columns.length} columns</span>
        {!isPeriod && (
          <>
            {' '}
            · headings are the {fieldLabel(group.settings.key?.target).toLowerCase()}s
            {labels.map((label) =>
              label.rows_above === 0 ? (
                <span key={label.target}> and the {fieldLabel(label.target).toLowerCase()}s</span>
              ) : (
                <span key={label.target}>
                  , {fieldLabel(label.target).toLowerCase()}s are {label.rows_above === 1 ? 'the row' : `${label.rows_above} rows`} above
                </span>
              ),
            )}
          </>
        )}
        {isPeriod && entry?.first && (
          <>
            {' '}
            · {periodLabel(entry.first, periodType)} to {periodLabel(entry.last, periodType)}
          </>
        )}
      </p>

      {edited && (
        <p className="mt-1 text-[11px] text-amber-900">Settings changed. Test your changes to see the result.</p>
      )}

      <Disclosure variant="link" summary="How the headings are read" className="mt-1 text-[11px] text-deep-violet-blue/70">
        {readings.length > 0 && !edited && (
          <table className="w-full text-left text-[11px] text-deep-violet-blue">
            <thead className="text-deep-violet-blue/60">
              <tr>
                <th className="py-0.5 pr-2 font-medium">Heading</th>
                <th className="py-0.5 pr-2 font-medium">Reads as</th>
                <th className="py-0.5 font-medium">e.g.</th>
              </tr>
            </thead>
            <tbody>
              {readings.map((reading) => (
                <tr key={reading.column}>
                  <td className="max-w-48 truncate py-0.5 pr-2 font-mono" title={reading.column}>
                    {reading.column}
                  </td>
                  <td className="py-0.5 pr-2 font-medium">
                    {isPeriod ? periodLabel(reading.readsAs, periodType) : reading.readsAs}
                  </td>
                  <td className="py-0.5 font-mono text-deep-violet-blue/70">{reading.sample ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {group.columns.length > readings.length && readings.length > 0 && !edited && (
          <p className="text-[11px] text-deep-violet-blue/60">…and {group.columns.length - readings.length} more</p>
        )}
        <div className="mt-1.5 space-y-1.5">
          {group.settings.select?.kind === 'pattern' && (
            <label className="block">
              Column name pattern (next month&apos;s columns match it too)
              <input
                type="text"
                value={group.settings.select.pattern || ''}
                disabled={disabled}
                onChange={(event) =>
                  onSettingsChange(group.id, { select: { ...group.settings.select, pattern: event.target.value } })
                }
                className={cn(inputClass, 'mt-0.5 py-1 font-mono text-[11px]')}
              />
            </label>
          )}
          {select.kind === 'between' && (
            <div className="grid gap-1.5 sm:grid-cols-2">
              <div>
                <p>Every column after (a new outlet is picked up too)</p>
                <SelectDropdown
                  value={select.after || ''}
                  onChange={(after) => setSelect({ after })}
                  size="sm"
                  searchable={columns.length > 8}
                  ariaLabel="The group starts after this column"
                  disabled={disabled}
                  options={columns.map((column) => ({ value: column, label: column }))}
                />
              </div>
              <div>
                <p>and before</p>
                <SelectDropdown
                  value={select.before || LAST_COLUMN}
                  onChange={(before) => setSelect({ before: before || undefined })}
                  size="sm"
                  searchable={columns.length > 8}
                  ariaLabel="The group ends before this column"
                  disabled={disabled}
                  options={[
                    { value: LAST_COLUMN, label: 'The end of the file' },
                    ...columns.map((column) => ({ value: column, label: column })),
                  ]}
                />
              </div>
            </div>
          )}
          {group.settings.select?.kind === 'columns' && <p>Exactly these {group.columns.length} columns.</p>}
          {isPeriod && (
            <div className="grid gap-1.5 sm:grid-cols-2">
              <label className="block">
                Where the date is in a heading (advanced)
                <input
                  type="text"
                  value={group.settings.key?.pattern || ''}
                  disabled={disabled}
                  onChange={(event) =>
                    onSettingsChange(group.id, { key: { ...group.settings.key, pattern: event.target.value } })
                  }
                  className={cn(inputClass, 'mt-0.5 py-1 font-mono text-[11px]')}
                />
              </label>
              <div>
                <p>Each heading is a</p>
                <SelectDropdown
                  value={periodType || 'month'}
                  onChange={(value) => onSettingsChange(group.id, { period_type: value })}
                  size="sm"
                  ariaLabel="Whether each heading is a month or a week"
                  disabled={disabled}
                  options={[
                    { value: 'month', label: 'Month' },
                    { value: 'week', label: 'Week' },
                  ]}
                />
              </div>
            </div>
          )}
          {isPeriod && (
            <label className="block">
              Date format in the headings
              <input
                type="text"
                value={group.settings.key?.date_format || ''}
                disabled={disabled}
                onChange={(event) =>
                  onSettingsChange(group.id, { key: { ...group.settings.key, date_format: event.target.value } })
                }
                className={cn(inputClass, 'mt-0.5 py-1 font-mono text-[11px]')}
              />
            </label>
          )}
        </div>
      </Disclosure>
    </div>
  );
}
