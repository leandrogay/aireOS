'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import StatusPill from '@/components/ui/StatusPill';
import TableGrid from '@/components/ui/TableGrid';
import TableRow from '@/components/ui/TableRow';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { getPromoAnchorHistory } from '@/app/services/promoUpliftsApi';
import { monthText } from '@/app/utils/promoUpliftCalc';
import {
  anchorLabel,
  anchorSourceLabel,
  sourceTone,
  changedByLabel,
  recommendedAnchorLabel,
  upcomingAnchorText,
} from '@/app/utils/promoUpliftSettings';
import { formatDateTime } from '@/lib/formatDate';

const HISTORY_COLUMNS = [
  { key: 'anchor', label: 'Anchor', width: '16rem' },
  { key: 'from', label: 'From', width: '7rem' },
  { key: 'source', label: 'Source' },
  { key: 'when', label: 'Saved', width: '15rem' },
];

function changedLabel(row) {
  return row.changed_at ? `${formatDateTime(row.changed_at)} · ${changedByLabel(row.changed_by)}` : changedByLabel(row.changed_by);
}

/**
 * One anchor clicked open (the SKU catalogue's SkuDetails is the model): a
 * customer's or SKU range's anchor this month, its next change, what the
 * data recommends now, and every saved version, newest first, with the
 * month each applies from. Adopt saves the recommendation; Overwrite picks a
 * mechanic (PromoAnchorOverwriteForm).
 *
 * @param {{
 *   target: { key: string, customerId: number, skuRange: string | null, name: string, anchorPct: number, row: object },
 *   windowMonths: number,
 *   readOnly: boolean,
 *   onEdit: (target: object) => void,
 *   onAdopt: (target: object) => void,
 *   onClose: () => void,
 * }} props
 */
export default function PromoAnchorDetails({ target, windowMonths, readOnly, onEdit, onAdopt, onClose }) {
  const { row } = target;
  const [history, setHistory] = useState({ rows: [], loading: true, error: null });

  useEffect(() => {
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

  const fields = [
    ['Anchor this month', anchorLabel(row)],
    ['Source', <StatusPill key="source" tone={sourceTone(row.source)}>{anchorSourceLabel(row.source)}</StatusPill>],
    ['Next change', upcomingAnchorText(row, monthText) ?? 'None planned'],
    ['Recommended now', recommendedAnchorLabel(row, windowMonths)],
    ['Last changed', row.changed_at ? formatDateTime(row.changed_at) : '—'],
  ];

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{target.name}</DialogTitle>
          <DialogDescription>
            The mechanic an ordinary month runs, which uplifts are measured from. It changes when you adopt a
            recommendation or overwrite it, and when official future promotions point to a new one.
          </DialogDescription>
        </DialogHeader>
        <dl className="grid gap-x-6 gap-y-3 rounded-lg border border-border p-4 sm:grid-cols-2">
          {fields.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="mt-0.5 font-medium">{value}</dd>
            </div>
          ))}
        </dl>
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
            <TableGrid variant="nested" columns={HISTORY_COLUMNS} minWidth="42rem">
              {history.rows.map((entry) => (
                <TableRow key={entry.id} className="h-11 border-b border-lavander/80 last:border-b-0">
                  <td className="px-4 py-2 tabular-nums">
                    <span className="inline-flex max-w-full items-center gap-1.5">
                      <span className="truncate font-medium" title={anchorLabel(entry)}>{anchorLabel(entry)}</span>
                      {entry.is_current ? (
                        <span className="shrink-0">
                          <StatusPill tone="success">Current</StatusPill>
                        </span>
                      ) : null}
                      {entry.is_upcoming ? (
                        <span className="shrink-0">
                          <StatusPill tone="info">Upcoming</StatusPill>
                        </span>
                      ) : null}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2">
                    {entry.effective_from ? monthText(entry.effective_from) : 'The start'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2">
                    <StatusPill tone={sourceTone(entry.source)}>{anchorSourceLabel(entry.source)}</StatusPill>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{changedLabel(entry)}</td>
                </TableRow>
              ))}
            </TableGrid>
          ) : null}
        </section>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          {!readOnly ? (
            <Button variant="outline" onClick={() => onEdit(target)}>Overwrite anchor</Button>
          ) : null}
          {!readOnly && row.recommendation_differs ? (
            <Button onClick={() => onAdopt(target)}>Adopt {row.recommended.mechanic_label}</Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
