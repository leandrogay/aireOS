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
import { errorClass, hintClass, inputClass, labelClass } from '@/components/ui/formStyles';
import { getPromoUpliftHistory, saveMechanicDiscount } from '@/app/services/promoUpliftsApi';
import { changedByLabel, parseDiscountInput } from '@/app/utils/promoUpliftSettings';
import { formatDateTime } from '@/lib/formatDate';

const HISTORY_COLUMNS = [
  { key: 'discount', label: 'Discount', width: '10rem' },
  { key: 'when', label: 'Saved' },
];

/**
 * Edit one mechanic's effective discount, with every discount it has had
 * (its all-customers versions, newest first). Saving queues a recalculation
 * of every customer, since the placeholder rule and anchors use it. A
 * dialog, opened from PromoMechanicTable.
 *
 * @param {object} props
 * @param {object} props.row the mechanic's all-customers setting row
 * @param {(result: object) => void} props.onSaved
 * @param {() => void} props.onCancel
 */
export default function PromoMechanicDiscountForm({ row, onSaved, onCancel }) {
  const [text, setText] = useState(row.effective_discount_pct != null ? String(row.effective_discount_pct) : '');
  const [submitting, setSubmitting] = useState(false);
  const [requestError, setRequestError] = useState(null);
  const [history, setHistory] = useState({ rows: [], loading: true, error: null });
  const { value, error } = parseDiscountInput(text);

  useEffect(() => {
    let cancelled = false;
    getPromoUpliftHistory(row.mechanic_key)
      .then((rows) => {
        // Narrower rows were typed uplifts; only the mechanic's own discount versions belong here.
        if (!cancelled) setHistory({ rows: rows.filter((entry) => entry.scope === 'all'), loading: false, error: null });
      })
      .catch((err) => {
        if (!cancelled) setHistory({ rows: [], loading: false, error: err.message });
      });
    return () => {
      cancelled = true;
    };
  }, [row.mechanic_key]);

  async function handleSubmit(event) {
    event.preventDefault();
    if (value == null) return;
    setSubmitting(true);
    setRequestError(null);
    try {
      onSaved(await saveMechanicDiscount(row.mechanic_key, { effective_discount_pct: value }));
    } catch (err) {
      setRequestError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!next && !submitting) onCancel(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit discount · {row.mechanic_label}</DialogTitle>
          <DialogDescription>
            The discount this mechanic counts as. The placeholder rule and the anchors that use it move with it.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <fieldset disabled={submitting} className="max-w-[11rem]">
            <label htmlFor="mechanic-discount" className={labelClass}>
              Discount (%)
            </label>
            <input
              id="mechanic-discount"
              type="text"
              inputMode="decimal"
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-invalid={Boolean(error)}
              className={inputClass}
            />
            {error ? <p className={errorClass}>{error}</p> : null}
          </fieldset>
          <p className={hintClass}>Every customer is recalculated after a save.</p>

          <section className="mt-4">
            <h3 className="mb-2 font-medium">Update history</h3>
            {history.loading ? <p className="text-sm text-muted-foreground">Loading history…</p> : null}
            {history.error ? (
              <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{history.error}</p>
            ) : null}
            {!history.loading && !history.error && history.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No versions saved yet.</p>
            ) : null}
            {history.rows.length ? (
              <TableGrid variant="nested" columns={HISTORY_COLUMNS} minWidth="24rem">
                {history.rows.map((entry) => (
                  <tr key={entry.id} className="h-11 border-b border-lavander/80 last:border-b-0">
                    <td className="px-4 py-2 tabular-nums">
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                        <span className="font-medium">
                          {entry.effective_discount_pct != null ? `${entry.effective_discount_pct}%` : '—'}
                        </span>
                        {entry.superseded_at ? null : <StatusPill tone="success">Current</StatusPill>}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {entry.changed_at ? `${formatDateTime(entry.changed_at)} · ${changedByLabel(entry.changed_by)}` : '—'}
                    </td>
                  </tr>
                ))}
              </TableGrid>
            ) : null}
          </section>

          <DialogFooter className="mt-4 items-center sm:justify-between">
            <p className="text-xs text-red-700" role="status">
              {requestError}
            </p>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting || value == null}>
                {submitting ? 'Saving…' : 'Save discount'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
