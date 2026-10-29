'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import StatusPill from '@/components/ui/StatusPill';
import TableGrid from '@/components/ui/TableGrid';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { getPromoAnchorHistory } from '@/app/services/promoUpliftsApi';
import { anchorSourceLabel, changedByLabel } from '@/app/utils/promoUpliftSettings';
import { formatDateTime } from '@/lib/formatDate';

const HISTORY_COLUMNS = [
  { key: 'discount', label: 'Discount', width: '12rem' },
  { key: 'source', label: 'Source' },
  { key: 'when', label: 'When', width: '15rem' },
];

function changedLabel(row) {
  return row.changed_at ? `${formatDateTime(row.changed_at)} · ${changedByLabel(row.changed_by)}` : changedByLabel(row.changed_by);
}

/**
 * One ordinary-month discount clicked open (the SKU catalogue's SkuDetails
 * is the model): its current value, the suggestion from the customer's own
 * promotions and every saved version, newest first. Edit hands over to
 * PromoAnchorForm, as SkuDetails hands over to SkuForm. The all-customers
 * value (`target.row` null) has no per-customer history to show.
 *
 * @param {{
 *   target: { key: string, customerId: number | null, name: string, anchorPct: number, row: object | null },
 *   readOnly: boolean,
 *   onEdit: (target: object) => void,
 *   onReset: (row: object) => void,
 *   onClose: () => void,
 * }} props
 */
export default function PromoAnchorDetails({ target, readOnly, onEdit, onReset, onClose }) {
  const { row } = target;
  const [history, setHistory] = useState({ rows: [], loading: Boolean(row), error: null });

  useEffect(() => {
    if (target.customerId == null) return undefined;
    let cancelled = false;
    getPromoAnchorHistory(target.customerId)
      .then((rows) => {
        if (!cancelled) setHistory({ rows, loading: false, error: null });
      })
      .catch((err) => {
        if (!cancelled) setHistory({ rows: [], loading: false, error: err.message });
      });
    return () => {
      cancelled = true;
    };
  }, [target.customerId]);

  const fields = row
    ? [
        ['Ordinary-month discount', `${row.anchor_pct}%`],
        ['Source', anchorSourceLabel(row.source)],
        [
          'Suggested from data',
          row.suggested
            ? `${row.suggested.anchor_pct}% (median of ${row.suggested.months_used} months)`
            : 'No usable promotions yet',
        ],
        ['Last changed', row.changed_at ? formatDateTime(row.changed_at) : '—'],
      ]
    : [
        ['Ordinary-month discount', `${target.anchorPct}%`],
        ['Used for', 'A customer with no promotions to suggest from'],
      ];

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{row ? target.name : 'All customers (fallback)'}</DialogTitle>
          <DialogDescription>
            {row
              ? 'Current ordinary-month discount and its recorded update history.'
              : 'The ordinary-month discount used when a customer has nothing to suggest from.'}
          </DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg border border-border p-4">
          {fields.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="mt-0.5 font-medium">{value}</dd>
            </div>
          ))}
        </dl>
        {row ? (
          <section>
            <h3 className="mb-2 font-medium">Update history</h3>
            {history.loading ? <p className="text-sm text-muted-foreground">Loading history…</p> : null}
            {history.error ? (
              <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{history.error}</p>
            ) : null}
            {!history.loading && !history.error && history.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No versions saved yet.</p>
            ) : null}
            {history.rows.length ? (
              <TableGrid variant="nested" columns={HISTORY_COLUMNS} minWidth="36rem">
                {history.rows.map((entry) => (
                  <tr key={entry.id} className="h-11 border-b border-lavander/80 last:border-b-0">
                    <td className="px-4 py-2 tabular-nums">
                      <span className="font-medium">{entry.anchor_pct != null ? `${entry.anchor_pct}%` : 'Use suggestion'}</span>
                      {entry.is_current ? (
                        <span className="ml-1.5">
                          <StatusPill tone="success">Current</StatusPill>
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2">{anchorSourceLabel(entry.source)}</td>
                    <td className="px-4 py-2 text-muted-foreground">{changedLabel(entry)}</td>
                  </tr>
                ))}
              </TableGrid>
            ) : null}
          </section>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          {!readOnly && row?.source === 'manual' ? (
            <Button variant="outline" onClick={() => onReset(row)}>Use suggestion</Button>
          ) : null}
          {readOnly ? null : <Button onClick={() => onEdit(target)}>Edit discount</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
