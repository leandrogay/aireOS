'use client';

import { useState } from 'react';
import { Eye, Pencil, RotateCcw } from 'lucide-react';

import RowActions from '@/components/ui/RowActions';
import { formatDateTime } from '@/lib/formatDate';
import { changedByLabel, scopeLabel } from '@/app/utils/promoUpliftSettings';
import { formatPct, sourceLabel } from '@/app/utils/scenarioPromotions';
import { cn } from '@/lib/utils';

// Laid out like the Forecast page's Monthly values table (ForecastTable):
// cream sticky header, a capped height with Expand, every row shown -- no
// pagination, there are only a few dozen mechanics.
const thClass = 'px-2.5 py-2 text-[10px] font-semibold uppercase tracking-wide text-deep-violet-blue/60';
const tdClass = 'px-2.5 py-2';
const numClass = 'text-right tabular-nums';

const SOURCE_TAG_CLASS = {
  placeholder: 'border-violet/40 bg-cream',
  estimate: 'border-deep-violet-blue/30 bg-lavander',
  measured: 'border-emerald-600/30 bg-emerald-50',
  learned: 'border-sky-600/30 bg-sky-50',
};

/**
 * Every current uplift row: mechanic, effective discount, uplift, who it
 * applies to and where the value came from. Clicking a row opens its details
 * (history, Edit, Reset) in PromoUpliftDetails, as the SKU catalogue does;
 * the "..." menu opens the same dialog, straight into editing for Edit.
 * Learned rows are read-only.
 *
 * @param {object} props
 * @param {object[]} props.rows setting rows from getPromoUpliftSettings
 * @param {(row: object) => number} props.shownUplift the uplift to show for a row
 * @param {boolean} props.readOnly sample values: view only
 * @param {(row: object, options?: { editing: boolean }) => void} props.onView
 * @param {(row: object) => void} props.onReset
 */
export default function PromoUpliftTable({ rows, shownUplift, readOnly, onView, onReset }) {
  const [expanded, setExpanded] = useState(false);

  function rowActions(row) {
    const actions = [{ key: 'view', label: 'View details', icon: Eye, onSelect: () => onView(row) }];
    if (readOnly) return actions;
    const learnedReason = row.source === 'learned' ? 'Set by the forecasting model' : undefined;
    actions.push({
      key: 'edit',
      label: 'Edit uplift',
      icon: Pencil,
      onSelect: () => onView(row, { editing: true }),
      disabledReason: learnedReason,
    });
    if (row.source !== 'placeholder') {
      actions.push({
        key: 'reset',
        label: row.scope === 'all' ? 'Reset to placeholder' : 'Remove',
        icon: RotateCcw,
        onSelect: () => onReset(row),
        disabledReason: learnedReason,
      });
    }
    return actions;
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[11px] text-deep-violet-blue/70">
          {rows.length} uplift value{rows.length === 1 ? '' : 's'} · click a row for its history and to edit it
        </p>
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="rounded-md border border-deep-violet-blue/30 bg-white px-3 py-1 text-xs font-medium text-deep-violet-blue transition hover:bg-cream"
        >
          {expanded ? 'Collapse' : 'Expand'}
        </button>
      </div>

      <div className="overflow-x-auto rounded-md border border-lavander">
        <div className={expanded ? '' : 'max-h-[40vh] overflow-y-auto'}>
          <table className="w-full text-left text-xs text-deep-violet-blue">
            <thead className="sticky top-0 z-10 bg-cream">
              <tr className="border-b border-lavander">
                <th className={thClass}>Mechanic</th>
                <th className={cn(thClass, numClass)}>Discount</th>
                <th className={cn(thClass, numClass)}>Uplift</th>
                <th className={thClass}>Applies to</th>
                <th className={thClass}>Source</th>
                <th className={thClass}>Last changed</th>
                <th className={cn(thClass, 'w-12')}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td className="px-2.5 py-3 text-deep-violet-blue/80" colSpan={7}>
                    No uplift values yet.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr
                    key={row.id}
                    onClick={() => onView(row)}
                    className="cursor-pointer border-b border-lavander/80 bg-white last:border-b-0 hover:bg-cream/50"
                  >
                    <td className={cn(tdClass, 'font-medium')}>{row.mechanic_label}</td>
                    <td className={cn(tdClass, numClass)}>
                      {row.effective_discount_pct != null ? `${row.effective_discount_pct}%` : '—'}
                    </td>
                    <td className={cn(tdClass, numClass)}>
                      {formatPct(shownUplift(row))}
                      {row.follows_anchor ? (
                        <span className="block text-[10px] text-deep-violet-blue/50">moves with anchor</span>
                      ) : null}
                    </td>
                    <td className={tdClass}>{scopeLabel(row)}</td>
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
                    <td className={cn(tdClass, 'whitespace-nowrap')}>
                      {row.changed_at
                        ? `${formatDateTime(row.changed_at)} · ${changedByLabel(row.changed_by)}`
                        : changedByLabel(row.changed_by)}
                    </td>
                    <td className="px-1 py-1 text-right" onClick={(event) => event.stopPropagation()}>
                      <RowActions label={`Actions for ${row.mechanic_label}`} actions={rowActions(row)} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
