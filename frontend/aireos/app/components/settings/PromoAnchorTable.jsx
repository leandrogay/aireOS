'use client';

import { History, Pencil, RotateCcw } from 'lucide-react';

import RowActions from '@/components/ui/RowActions';
import TableGrid from '@/components/ui/TableGrid';
import { formatDateTime } from '@/lib/formatDate';
import { retailerLabel } from '@/app/utils/retailerLabel';
import { anchorSourceLabel } from '@/app/utils/promoUpliftSettings';

import { PROMO_ANCHOR_COLUMNS } from './promoUpliftColumns';

/**
 * Every customer's ordinary-month discount (the anchor rule-based uplifts
 * are measured from), with the suggestion from its own promotions, and the
 * all-customers value as the last row. Each row's "..." menu has Edit details
 * and History (dialogs the view owns) and, for a value typed by hand, Use
 * suggested value. Holds no state.
 *
 * @param {object} props
 * @param {{ default_anchor_pct: number, customers: object[] }} props.anchors from getPromoAnchors
 * @param {boolean} props.readOnly sample values: no actions
 * @param {(target: { customerId: number | null, name: string, anchorPct: number, row: object | null }) => void} props.onEdit
 * @param {(row: object) => void} props.onReset
 * @param {(row: object) => void} props.onHistory
 */
export default function PromoAnchorTable({ anchors, readOnly, onEdit, onReset, onHistory }) {
  function editTarget(row) {
    return { customerId: row.customer_id, name: retailerLabel(row.customer_name), anchorPct: row.anchor_pct, row };
  }

  function actionsFor(row) {
    const actions = [
      { key: 'edit', label: 'Edit details', icon: Pencil, onSelect: () => onEdit(editTarget(row)) },
      { key: 'history', label: 'History', icon: History, onSelect: () => onHistory(row) },
    ];
    if (row.source === 'manual') {
      actions.push({ key: 'reset', label: 'Use suggested value', icon: RotateCcw, onSelect: () => onReset(row) });
    }
    return actions;
  }

  // The all-customers value has no history endpoint (anchors are saved per
  // customer), so its menu is Edit details only.
  const fallbackActions = [
    {
      key: 'edit',
      label: 'Edit details',
      icon: Pencil,
      onSelect: () =>
        onEdit({ customerId: null, name: 'All customers', anchorPct: anchors.default_anchor_pct, row: null }),
    },
  ];

  return (
    <TableGrid variant="nested" columns={PROMO_ANCHOR_COLUMNS} minWidth="64rem">
      {anchors.customers.map((row) => (
        <tr key={row.customer_id} className="h-11 border-b border-lavander/80 hover:bg-cream/60">
          <td className="truncate px-4 py-2 font-medium">{retailerLabel(row.customer_name)}</td>
          <td className="px-4 py-2 tabular-nums">{row.anchor_pct}%</td>
          <td className="px-4 py-2">{anchorSourceLabel(row.source)}</td>
          <td className="truncate px-4 py-2 text-xs text-deep-violet-blue/70">
            {row.suggested
              ? `${row.suggested.anchor_pct}% (median of ${row.suggested.months_used} months)`
              : 'No usable promotions yet'}
          </td>
          <td className="truncate px-4 py-2 text-xs">{row.changed_at ? formatDateTime(row.changed_at) : '—'}</td>
          <td className="px-2 py-1 text-right">
            {readOnly ? null : (
              <RowActions label={`Actions for ${retailerLabel(row.customer_name)}`} actions={actionsFor(row)} />
            )}
          </td>
        </tr>
      ))}
      <tr className="h-11 bg-cream/40">
        <td className="px-4 py-2 font-medium">All customers (fallback)</td>
        <td className="px-4 py-2 tabular-nums">{anchors.default_anchor_pct}%</td>
        <td className="truncate px-4 py-2 text-xs text-deep-violet-blue/70" colSpan={3}>
          Used for a customer with no promotions to suggest from.
        </td>
        <td className="px-2 py-1 text-right">
          {readOnly ? null : <RowActions label="Actions for All customers" actions={fallbackActions} />}
        </td>
      </tr>
    </TableGrid>
  );
}
