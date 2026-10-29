'use client';

import { Eye, Pencil, RotateCcw } from 'lucide-react';

import RowActions from '@/components/ui/RowActions';
import { formatDateTime } from '@/lib/formatDate';
import { retailerLabel } from '@/app/utils/retailerLabel';
import { anchorSourceLabel } from '@/app/utils/promoUpliftSettings';
import { cn } from '@/lib/utils';

// Same layout as PromoUpliftTable (the Forecast page's Monthly values table):
// cream header, every row shown, no pagination.
const thClass = 'px-2.5 py-2 text-[10px] font-semibold uppercase tracking-wide text-deep-violet-blue/60';
const tdClass = 'px-2.5 py-2';
const numClass = 'text-right tabular-nums';
const rowClass = 'cursor-pointer border-b border-lavander/80 last:border-b-0 hover:bg-cream/50';

/**
 * Every customer's ordinary-month discount (the anchor placeholder uplifts
 * are measured from), with the suggestion from its own promotions, and the
 * all-customers value as the last row. Clicking a row opens its details
 * (history, Edit, Use suggestion) in PromoAnchorDetails, as the SKU
 * catalogue does; the "..." menu goes straight to each action. Holds no
 * state; the view owns edits.
 *
 * @param {object} props
 * @param {{ default_anchor_pct: number, customers: object[] }} props.anchors from getPromoAnchors
 * @param {string | null} props.editingKey 'default' or a customer_id being edited
 * @param {boolean} props.readOnly sample values: view only
 * @param {(target: object) => void} props.onView
 * @param {(target: object) => void} props.onEdit
 * @param {(row: object) => void} props.onReset
 */
export default function PromoAnchorTable({ anchors, editingKey, readOnly, onView, onEdit, onReset }) {
  const defaultTarget = {
    key: 'default',
    customerId: null,
    name: 'All customers',
    anchorPct: anchors.default_anchor_pct,
    row: null,
  };

  function rowActions(target) {
    const actions = [{ key: 'view', label: 'View details', icon: Eye, onSelect: () => onView(target) }];
    if (readOnly) return actions;
    actions.push({
      key: 'edit',
      label: 'Edit discount',
      icon: Pencil,
      onSelect: () => onEdit(target),
      disabledReason: editingKey === target.key ? 'Editing now' : undefined,
    });
    if (target.row?.source === 'manual') {
      actions.push({ key: 'reset', label: 'Use suggestion', icon: RotateCcw, onSelect: () => onReset(target.row) });
    }
    return actions;
  }

  return (
    <div className="overflow-x-auto rounded-md border border-lavander">
      <table className="w-full text-left text-xs text-deep-violet-blue">
        <thead className="bg-cream">
          <tr className="border-b border-lavander">
            <th className={thClass}>Customer</th>
            <th className={cn(thClass, numClass)}>Ordinary-month discount</th>
            <th className={thClass}>Source</th>
            <th className={thClass}>Suggested from data</th>
            <th className={thClass}>Last changed</th>
            <th className={cn(thClass, 'w-12')}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {anchors.customers.map((row) => {
            const target = {
              key: String(row.customer_id),
              customerId: row.customer_id,
              name: retailerLabel(row.customer_name),
              anchorPct: row.anchor_pct,
              row,
            };
            return (
              <tr
                key={target.key}
                onClick={() => onView(target)}
                className={cn(rowClass, editingKey === target.key ? 'bg-cream' : 'bg-white')}
              >
                <td className={cn(tdClass, 'font-medium')}>{target.name}</td>
                <td className={cn(tdClass, numClass)}>{row.anchor_pct}%</td>
                <td className={tdClass}>{anchorSourceLabel(row.source)}</td>
                <td className={cn(tdClass, 'text-deep-violet-blue/70')}>
                  {row.suggested
                    ? `${row.suggested.anchor_pct}% (median of ${row.suggested.months_used} months)`
                    : 'No usable promotions yet'}
                </td>
                <td className={cn(tdClass, 'whitespace-nowrap')}>{formatDateTime(row.changed_at)}</td>
                <td className="px-1 py-1 text-right" onClick={(event) => event.stopPropagation()}>
                  <RowActions label={`Actions for ${target.name}`} actions={rowActions(target)} />
                </td>
              </tr>
            );
          })}
          <tr
            onClick={() => onView(defaultTarget)}
            className={cn(rowClass, editingKey === 'default' ? 'bg-cream' : 'bg-cream/40')}
          >
            <td className={cn(tdClass, 'font-medium')}>All customers (fallback)</td>
            <td className={cn(tdClass, numClass)}>{anchors.default_anchor_pct}%</td>
            <td className={cn(tdClass, 'text-deep-violet-blue/70')} colSpan={3}>
              Used for a customer with no promotions to suggest from.
            </td>
            <td className="px-1 py-1 text-right" onClick={(event) => event.stopPropagation()}>
              <RowActions label="Actions for All customers" actions={rowActions(defaultTarget)} />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
