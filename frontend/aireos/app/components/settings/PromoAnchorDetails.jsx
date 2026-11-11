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
import {
  anchorLabel,
  anchorSourceLabel,
  sourceTone,
  changedByLabel,
  recommendedAnchorLabel,
} from '@/app/utils/promoUpliftSettings';
import { formatDateTime } from '@/lib/formatDate';

const HISTORY_COLUMNS = [
  { key: 'anchor', label: 'Anchor', width: '16rem' },
  { key: 'source', label: 'Source' },
  { key: 'when', label: 'When', width: '15rem' },
];

function changedLabel(row) {
  return row.changed_at ? `${formatDateTime(row.changed_at)} · ${changedByLabel(row.changed_by)}` : changedByLabel(row.changed_by);
}

/**
 * One anchor clicked open (the SKU catalogue's SkuDetails is the model): a
 * customer's or SKU range's current anchor, what the data recommends now,
 * and every saved version, newest first. Adopt saves the recommendation;
 * a discount can be typed (PromoAnchorForm) only with too few moments to
 * recommend from. The all-customers value (`target.row` null) has no
 * history to show.
 *
 * @param {{
 *   target: { key: string, customerId: number | null, skuRange: string | null, name: string, anchorPct: number, row: object | null },
 *   windowMonths: number,
 *   readOnly: boolean,
 *   onEdit: (target: object) => void,
 *   onAdopt: (target: object) => void,
 *   onClose: () => void,
 * }} props
 */
export default function PromoAnchorDetails({ target, windowMonths, readOnly, onEdit, onAdopt, onClose }) {
  const { row } = target;
  const [history, setHistory] = useState({ rows: [], loading: Boolean(row), error: null });

  useEffect(() => {
    if (target.customerId == null) return undefined;
    let cancelled = false;
    getPromoAnchorHistory(target.customerId, target.skuRange)
      .then((rows) => {
        if (!cancelled) setHistory({ rows, loading: false, error: null });
      })
      .catch((err) => {
        if (!cancelled) setHistory({ rows: [], loading: false, error: err.message });
      });
    return () => {
      cancelled = true;
    };
  }, [target.customerId, target.skuRange]);

  const fields = row
    ? [
        ['Anchor', anchorLabel(row)],
        ['Source', <StatusPill key="source" tone={sourceTone(row.source)}>{anchorSourceLabel(row.source)}</StatusPill>],
        ['Recommended now', recommendedAnchorLabel(row, windowMonths)],
        ['Last changed', row.changed_at ? formatDateTime(row.changed_at) : '—'],
      ]
    : [
        ['Anchor', `${target.anchorPct}% off`],
        ['Used for', 'A customer with no anchor of its own'],
      ];

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{row ? target.name : 'All customers (fallback)'}</DialogTitle>
          <DialogDescription>
            {row
              ? 'The mechanic an ordinary month runs, which uplifts are measured from. It only changes when you adopt a new recommendation.'
              : 'The ordinary-month discount used when a customer has no anchor of its own.'}
          </DialogDescription>
        </DialogHeader>
        <dl className="grid gap-x-6 gap-y-3 rounded-lg border border-border p-4 sm:grid-cols-2">
          {fields.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-ink-soft">{label}</dt>
              <dd className="mt-0.5 font-medium">{value}</dd>
            </div>
          ))}
        </dl>
        {row ? (
          <section>
            <h3 className="mb-2 font-medium">Update history</h3>
            {history.loading ? <p className="text-sm text-ink-soft">Loading history…</p> : null}
            {history.error ? (
              <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{history.error}</p>
            ) : null}
            {!history.loading && !history.error && history.rows.length === 0 ? (
              <p className="text-sm text-ink-soft">No versions saved yet.</p>
            ) : null}
            {history.rows.length ? (
              <TableGrid variant="nested" columns={HISTORY_COLUMNS} minWidth="36rem">
                {history.rows.map((entry) => (
                  <tr key={entry.id} className="h-11 border-b border-lavander/80 last:border-b-0">
                    <td className="px-4 py-2 tabular-nums">
                      <span className="inline-flex max-w-full items-center gap-1.5">
                        <span className="truncate font-medium" title={anchorLabel(entry)}>{anchorLabel(entry)}</span>
                        {entry.is_current ? (
                          <span className="shrink-0">
                            <StatusPill tone="success">Current</StatusPill>
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2">
                      <StatusPill tone={sourceTone(entry.source)}>{anchorSourceLabel(entry.source)}</StatusPill>
                    </td>
                    <td className="px-4 py-2 text-ink-soft">{changedLabel(entry)}</td>
                  </tr>
                ))}
              </TableGrid>
            ) : null}
          </section>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          {!readOnly && (!row || row.manual_allowed) ? (
            <Button variant="outline" onClick={() => onEdit(target)}>Type a discount</Button>
          ) : null}
          {!readOnly && row?.recommendation_differs ? (
            <Button onClick={() => onAdopt(target)}>Adopt {row.recommended.mechanic_label}</Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
