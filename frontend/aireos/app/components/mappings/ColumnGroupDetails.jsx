'use client';

import { inputClass } from '@/components/inventory/formStyles';
import Disclosure from '@/components/ui/Disclosure';
import { periodLabel } from '@/app/utils/mappingReview';
import { cn } from '@/lib/utils';

/**
 * A group of period (or outlet) columns read as one: how many, the periods it
 * covers, and how its first headings read -- "SALES | Month 1 | 01-01-2026 →
 * Jan 2026" -- so a wrong date format shows before anything is run. The
 * readings come from the backend (mapping_view.column_groups), which parses
 * the headings exactly as the transformation will.
 *
 * One line is always shown -- how many columns, which periods. How the
 * headings read and the hand-typed column pattern and date format are folded
 * under Details: what a typed pattern picks is only known once the checks run.
 *
 * @param {{
 *   group: object,
 *   entry: object | null,
 *   onSettingsChange: (groupId: string, changes: object) => void,
 *   disabled: boolean,
 * }} props
 */
export default function ColumnGroupDetails({ group, entry, onSettingsChange, disabled }) {
  const periodType = group.settings.period_type;
  const isPeriod = group.settings.key?.target === 'period_start';
  const readings = entry?.readings || [];
  const edited =
    entry && JSON.stringify({ select: entry.group.select, key: entry.group.key }) !==
      JSON.stringify({ select: group.settings.select, key: group.settings.key });

  return (
    <div className="rounded-md bg-cream/60 px-2 py-1.5">
      <p className="text-[11px] text-deep-violet-blue">
        One row per {isPeriod ? (periodType === 'week' ? 'week' : 'month') : 'outlet'} from{' '}
        <span className="font-medium">{group.columns.length} columns</span>
        {isPeriod && entry?.first && (
          <>
            {' '}
            · {periodLabel(entry.first, periodType)} to {periodLabel(entry.last, periodType)}
          </>
        )}
      </p>

      {edited && (
        <p className="mt-1 text-[11px] text-amber-900">Settings changed — run the checks to see the result.</p>
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
          {group.settings.select?.kind === 'between' && (
            <p>
              Every column between <span className="font-mono">{group.settings.select.after}</span> and{' '}
              <span className="font-mono">{group.settings.select.before || 'the last column'}</span>, so a new
              outlet is picked up too.
            </p>
          )}
          {group.settings.select?.kind === 'columns' && <p>Exactly these {group.columns.length} columns.</p>}
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
