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
import { inputClass } from '@/components/inventory/formStyles';
import { getPromoUpliftHistory } from '@/app/services/promoUpliftsApi';
import { changedByLabel, parseUpliftInput, scopeLabel } from '@/app/utils/promoUpliftSettings';
import { formatPct, sourceLabel } from '@/app/utils/scenarioPromotions';
import { formatDateTime } from '@/lib/formatDate';
import { cn } from '@/lib/utils';

const HISTORY_COLUMNS = [
  { key: 'uplift', label: 'Uplift', width: '6rem' },
  { key: 'appliesTo', label: 'Applies to' },
  { key: 'source', label: 'Source', width: '8rem' },
  { key: 'when', label: 'When', width: '13rem' },
  { key: 'note', label: 'Note' },
];

function changedLabel(row) {
  return row.changed_at ? `${formatDateTime(row.changed_at)} · ${changedByLabel(row.changed_by)}` : changedByLabel(row.changed_by);
}

/**
 * One uplift row clicked open (the SKU catalogue's SkuDetails is the
 * model): its current value, Edit / Reset, and every saved version of the
 * mechanic, newest first. Every save is a new version with a new id, so the
 * view closes this dialog after a save or reset rather than keep a stale row.
 *
 * @param {{
 *   row: object,
 *   shownUplift: number | null,
 *   startEditing?: boolean,
 *   readOnly: boolean,
 *   onSave: (row: object, upliftPct: number) => Promise<boolean>,
 *   onReset: (row: object) => void,
 *   onClose: () => void,
 * }} props
 */
export default function PromoUpliftDetails({ row, shownUplift, startEditing = false, readOnly, onSave, onReset, onClose }) {
  const [history, setHistory] = useState({ rows: [], loading: true, error: null });
  const [editing, setEditing] = useState(startEditing ? { text: String(shownUplift), saving: false } : null);
  const parsed = editing ? parseUpliftInput(editing.text) : null;
  const canChange = !readOnly && row?.source !== 'learned';

  useEffect(() => {
    let cancelled = false;
    getPromoUpliftHistory(row.mechanic_key)
      .then((rows) => {
        if (!cancelled) setHistory({ rows, loading: false, error: null });
      })
      .catch((err) => {
        if (!cancelled) setHistory({ rows: [], loading: false, error: err.message });
      });
    return () => {
      cancelled = true;
    };
  }, [row.mechanic_key]);

  async function save() {
    if (parsed?.value == null) return;
    setEditing((current) => ({ ...current, saving: true }));
    const saved = await onSave(row, parsed.value);
    if (!saved) setEditing((current) => current && { ...current, saving: false });
  }

  const fields = [
    ['Discount', row.effective_discount_pct != null ? `${row.effective_discount_pct}%` : '—'],
    ['Applies to', scopeLabel(row)],
    ['Source', sourceLabel(row.source)],
    ['Last changed', changedLabel(row) || '—'],
  ];

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{row.mechanic_label}</DialogTitle>
          <DialogDescription>Current uplift value and every saved version of this mechanic.</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg border border-border p-4">
          <div>
            <dt className="text-xs text-muted-foreground">Uplift</dt>
            <dd className="mt-0.5 font-medium">
              {editing ? (
                <div className="w-28">
                  <input
                    aria-label={`Uplift for ${row.mechanic_label}`}
                    value={editing.text}
                    disabled={editing.saving}
                    autoFocus
                    onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') save();
                    }}
                    className={cn(inputClass, 'py-1 text-right')}
                  />
                  {parsed?.error ? <p className="mt-0.5 text-[11px] font-normal text-red-700">{parsed.error}</p> : null}
                </div>
              ) : (
                <>
                  {formatPct(shownUplift)}
                  {row.follows_anchor ? (
                    <span className="block text-[11px] font-normal text-muted-foreground">moves with anchor</span>
                  ) : null}
                </>
              )}
            </dd>
          </div>
          {fields.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="mt-0.5 font-medium">{value}</dd>
            </div>
          ))}
          {row.note ? (
            <div className="col-span-2">
              <dt className="text-xs text-muted-foreground">Note</dt>
              <dd className="mt-0.5">{row.note}</dd>
            </div>
          ) : null}
        </dl>
        {row.source === 'learned' ? (
          <p className="text-xs text-muted-foreground">
            Set by the forecasting model after each retrain. Override it for a single promotion in the Scenario builder.
          </p>
        ) : null}
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
            <TableGrid variant="nested" columns={HISTORY_COLUMNS} minWidth="46rem">
              {history.rows.map((entry) => (
                <tr key={entry.id} className="h-11 border-b border-lavander/80 last:border-b-0">
                  <td className="px-4 py-2 tabular-nums">
                    <span className="font-medium">{formatPct(entry.uplift_pct)}</span>
                    {entry.superseded_at ? null : (
                      <span className="ml-1.5">
                        <StatusPill tone="success">Current</StatusPill>
                      </span>
                    )}
                  </td>
                  <td className="truncate px-4 py-2" title={scopeLabel(entry)}>{scopeLabel(entry)}</td>
                  <td className="px-4 py-2">{sourceLabel(entry.source)}</td>
                  <td className="px-4 py-2 text-muted-foreground">{changedLabel(entry)}</td>
                  <td className="truncate px-4 py-2 text-muted-foreground" title={entry.note ?? undefined}>
                    {entry.note || '—'}
                  </td>
                </tr>
              ))}
            </TableGrid>
          ) : null}
        </section>
        <DialogFooter>
          {editing ? (
            <>
              <Button variant="outline" disabled={editing.saving} onClick={() => setEditing(null)}>Cancel</Button>
              <Button disabled={editing.saving || parsed?.value == null} onClick={save}>
                {editing.saving ? 'Saving…' : 'Save uplift'}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>Close</Button>
              {canChange && row.source !== 'placeholder' ? (
                <Button variant="outline" onClick={() => onReset(row)}>
                  {row.scope === 'all' ? 'Reset to placeholder' : 'Remove'}
                </Button>
              ) : null}
              {canChange ? (
                <Button onClick={() => setEditing({ text: String(shownUplift), saving: false })}>Edit uplift</Button>
              ) : null}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
