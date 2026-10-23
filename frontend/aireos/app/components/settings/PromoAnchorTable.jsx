'use client';

import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/lib/formatDate';
import { retailerLabel } from '@/app/utils/retailerLabel';
import { anchorSourceLabel } from '@/app/utils/promoUpliftSettings';
import { cn } from '@/lib/utils';

const thClass = 'bg-lavander px-2 py-1.5 text-left text-xs font-semibold text-deep-violet-blue';
const tdClass = 'px-2 py-1.5 text-sm text-deep-violet-blue';
const numClass = 'text-right tabular-nums';
const actionClass = 'h-auto rounded-md px-2.5 py-1 text-xs font-medium';

/**
 * Every customer's ordinary-month discount (the anchor placeholder uplifts
 * are measured from), with the suggestion from its own promotions, and the
 * all-customers value as the last row. Holds no state; the view owns edits.
 *
 * @param {object} props
 * @param {{ default_anchor_pct: number, customers: object[] }} props.anchors from getPromoAnchors
 * @param {string | null} props.editingKey 'default' or a customer_id being edited
 * @param {boolean} props.readOnly sample values: no actions
 * @param {(target: object) => void} props.onEdit
 * @param {(row: object) => void} props.onReset
 * @param {(row: object) => void} props.onHistory
 */
export default function PromoAnchorTable({ anchors, editingKey, readOnly, onEdit, onReset, onHistory }) {
  const defaultTarget = {
    key: 'default',
    customerId: null,
    name: 'All customers',
    anchorPct: anchors.default_anchor_pct,
  };

  return (
    <div className="overflow-auto rounded-md border border-lavander">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={thClass}>Customer</th>
            <th className={cn(thClass, numClass)}>Ordinary-month discount</th>
            <th className={thClass}>Source</th>
            <th className={thClass}>Suggested from data</th>
            <th className={thClass}>Last changed</th>
            <th className={thClass}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {anchors.customers.map((row) => {
            const key = String(row.customer_id);
            return (
              <tr key={key} className={cn('border-t border-lavander', editingKey === key && 'bg-cream')}>
                <td className={cn(tdClass, 'font-medium')}>{retailerLabel(row.customer_name)}</td>
                <td className={cn(tdClass, numClass)}>{row.anchor_pct}%</td>
                <td className={tdClass}>{anchorSourceLabel(row.source)}</td>
                <td className={cn(tdClass, 'text-xs text-deep-violet-blue/70')}>
                  {row.suggested
                    ? `${row.suggested.anchor_pct}% (median of ${row.suggested.months_used} months)`
                    : 'No usable promotions yet'}
                </td>
                <td className={cn(tdClass, 'whitespace-nowrap text-xs')}>{formatDateTime(row.changed_at)}</td>
                <td className={tdClass}>
                  {readOnly ? null : (
                    <div className="flex justify-end gap-1.5">
                      <Button
                        size="sm"
                        variant="ghost"
                        className={actionClass}
                        onClick={() => onHistory(row)}
                      >
                        History
                      </Button>
                      {row.source === 'manual' ? (
                        <Button size="sm" variant="ghost" className={actionClass} onClick={() => onReset(row)}>
                          Use suggestion
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        className={cn(actionClass, 'bg-deep-violet-blue text-white hover:bg-deep-violet-blue/90')}
                        onClick={() =>
                          onEdit({ key, customerId: row.customer_id, name: retailerLabel(row.customer_name), anchorPct: row.anchor_pct })
                        }
                      >
                        {editingKey === key ? 'Editing' : 'Edit'}
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
          <tr className={cn('border-t border-lavander bg-cream/40', editingKey === 'default' && 'bg-cream')}>
            <td className={cn(tdClass, 'font-medium')}>All customers (fallback)</td>
            <td className={cn(tdClass, numClass)}>{anchors.default_anchor_pct}%</td>
            <td className={cn(tdClass, 'text-xs text-deep-violet-blue/70')} colSpan={3}>
              Used for a customer with no promotions to suggest from.
            </td>
            <td className={tdClass}>
              {readOnly ? null : (
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    className={cn(actionClass, 'bg-deep-violet-blue text-white hover:bg-deep-violet-blue/90')}
                    onClick={() => onEdit(defaultTarget)}
                  >
                    {editingKey === 'default' ? 'Editing' : 'Edit'}
                  </Button>
                </div>
              )}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
