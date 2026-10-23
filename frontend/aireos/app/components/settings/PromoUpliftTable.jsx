'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/lib/formatDate';
import { inputClass } from '@/components/inventory/formStyles';
import { changedByLabel, parseUpliftInput, placeholderUplift, scopeLabel } from '@/app/utils/promoUpliftSettings';
import { formatPct, sourceLabel } from '@/app/utils/scenarioPromotions';
import { cn } from '@/lib/utils';

const thClass = 'bg-lavander px-2 py-1.5 text-left text-xs font-semibold text-deep-violet-blue';
const tdClass = 'px-2 py-1.5 text-sm text-deep-violet-blue';
const numClass = 'text-right tabular-nums';
const actionClass = 'h-auto rounded-md px-2.5 py-1 text-xs font-medium';

const SOURCE_TAG_CLASS = {
  placeholder: 'border-violet/40 bg-cream',
  estimate: 'border-deep-violet-blue/30 bg-lavander',
  measured: 'border-emerald-600/30 bg-emerald-50',
  learned: 'border-sky-600/30 bg-sky-50',
};

/**
 * Every current uplift row: mechanic, effective discount, uplift, who it
 * applies to and where the value came from. Uplift is edited in place
 * (saved as an Estimate, which stops following the anchor); Reset puts a
 * value back on the placeholder rule, or retires an override. Learned rows
 * are read-only.
 *
 * @param {object} props
 * @param {object[]} props.rows setting rows from getPromoUpliftSettings
 * @param {number} props.defaultAnchorPct placeholder values are shown at this anchor
 * @param {boolean} props.readOnly sample values: no actions
 * @param {(row: object, upliftPct: number) => Promise<boolean>} props.onSave resolves true when saved
 * @param {(row: object) => void} props.onReset
 * @param {(row: object) => void} props.onHistory
 */
export default function PromoUpliftTable({ rows, defaultAnchorPct, readOnly, onSave, onReset, onHistory }) {
  const [editing, setEditing] = useState(null);
  const parsed = editing ? parseUpliftInput(editing.text) : null;

  async function save(row) {
    if (parsed?.value == null) return;
    setEditing((current) => ({ ...current, saving: true }));
    const saved = await onSave(row, parsed.value);
    setEditing(saved ? null : (current) => current && { ...current, saving: false });
  }

  function shownUplift(row) {
    return row.follows_anchor ? placeholderUplift(row.effective_discount_pct, defaultAnchorPct) : row.uplift_pct;
  }

  return (
    <div className="overflow-auto rounded-md border border-lavander">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={thClass}>Mechanic</th>
            <th className={cn(thClass, numClass)}>Discount</th>
            <th className={cn(thClass, numClass)}>Uplift</th>
            <th className={thClass}>Applies to</th>
            <th className={thClass}>Source</th>
            <th className={thClass}>Last changed</th>
            <th className={thClass}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isEditing = editing?.id === row.id;
            return (
              <tr key={row.id} className={cn('border-t border-lavander', isEditing && 'bg-cream')}>
                <td className={cn(tdClass, 'font-medium')}>{row.mechanic_label}</td>
                <td className={cn(tdClass, numClass)}>
                  {row.effective_discount_pct != null ? `${row.effective_discount_pct}%` : '—'}
                </td>
                <td className={cn(tdClass, numClass)}>
                  {isEditing ? (
                    <div className="ml-auto w-24">
                      <input
                        aria-label={`Uplift for ${row.mechanic_label}`}
                        value={editing.text}
                        disabled={editing.saving}
                        onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') save(row);
                          if (e.key === 'Escape') setEditing(null);
                        }}
                        className={cn(inputClass, 'py-1 text-right')}
                      />
                      {parsed?.error ? <p className="mt-0.5 text-[11px] text-red-700">{parsed.error}</p> : null}
                    </div>
                  ) : (
                    <>
                      {formatPct(shownUplift(row))}
                      {row.follows_anchor ? (
                        <span className="block text-[10px] text-deep-violet-blue/50">moves with anchor</span>
                      ) : null}
                    </>
                  )}
                </td>
                <td className={cn(tdClass, 'text-xs')}>{scopeLabel(row)}</td>
                <td className={tdClass}>
                  <span
                    className={cn(
                      'whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px]',
                      SOURCE_TAG_CLASS[row.source]
                    )}
                    title={row.note ?? undefined}
                  >
                    {sourceLabel(row.source)}
                  </span>
                </td>
                <td className={cn(tdClass, 'whitespace-nowrap text-xs')}>
                  {row.changed_at
                    ? `${formatDateTime(row.changed_at)} · ${changedByLabel(row.changed_by)}`
                    : changedByLabel(row.changed_by)}
                </td>
                <td className={tdClass}>
                  {readOnly ? null : (
                    <div className="flex justify-end gap-1.5">
                      {isEditing ? (
                        <>
                          <Button size="sm" variant="ghost" className={actionClass} onClick={() => setEditing(null)}>
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            disabled={editing.saving || parsed?.value == null}
                            className={cn(actionClass, 'bg-deep-violet-blue text-white hover:bg-deep-violet-blue/90')}
                            onClick={() => save(row)}
                          >
                            {editing.saving ? 'Saving…' : 'Save'}
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button size="sm" variant="ghost" className={actionClass} onClick={() => onHistory(row)}>
                            History
                          </Button>
                          {row.source === 'learned' ? (
                            <span
                              className="px-2 py-1 text-[11px] text-deep-violet-blue/60"
                              title="Set by the forecasting model after each retrain. Override it for a single promotion in the Scenario builder."
                            >
                              Set by model
                            </span>
                          ) : (
                            <>
                              {row.source !== 'placeholder' ? (
                                <Button size="sm" variant="ghost" className={actionClass} onClick={() => onReset(row)}>
                                  {row.scope === 'all' ? 'Reset to placeholder' : 'Remove'}
                                </Button>
                              ) : null}
                              <Button
                                size="sm"
                                className={cn(actionClass, 'bg-deep-violet-blue text-white hover:bg-deep-violet-blue/90')}
                                onClick={() => setEditing({ id: row.id, text: String(shownUplift(row)), saving: false })}
                              >
                                Edit
                              </Button>
                            </>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
