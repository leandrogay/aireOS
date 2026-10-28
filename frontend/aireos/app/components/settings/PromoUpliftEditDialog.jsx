'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { errorClass, hintClass, inputClass, labelClass } from '@/components/inventory/formStyles';
import { changedByLabel, parseUpliftInput, scopeLabel } from '@/app/utils/promoUpliftSettings';
import { formatPct, sourceLabel } from '@/app/utils/scenarioPromotions';
import { formatDateTime } from '@/lib/formatDate';

/**
 * Edit one uplift row in a dialog (Edit details in its "..." menu): the row's
 * details up top, then the uplift and an optional note. Saving makes it an
 * Estimate, which stops following the ordinary-month discount.
 *
 * @param {object} props
 * @param {object} props.row the setting row being edited
 * @param {number} props.shownUplift the uplift the table shows for it (rule-based uplifts follow the rule)
 * @param {(row: object, upliftPct: number, note: string | null) => Promise<boolean>} props.onSave resolves true when saved
 * @param {() => void} props.onClose
 */
export default function PromoUpliftEditDialog({ row, shownUplift, onSave, onClose }) {
  const [form, setForm] = useState({ uplift: String(shownUplift), note: row.note ?? '' });
  const [saving, setSaving] = useState(false);
  const uplift = parseUpliftInput(form.uplift);

  const details = [
    ['Mechanic', row.mechanic_label],
    ['Discount', row.effective_discount_pct != null ? `${row.effective_discount_pct}%` : '—'],
    ['Applies to', scopeLabel(row)],
    ['Source', sourceLabel(row.source)],
    ['Current uplift', formatPct(shownUplift)],
    [
      'Last changed',
      row.changed_at
        ? `${formatDateTime(row.changed_at)} · ${changedByLabel(row.changed_by)}`
        : changedByLabel(row.changed_by),
    ],
  ];

  async function handleSubmit(event) {
    event.preventDefault();
    if (uplift.value == null) return;
    setSaving(true);
    const saved = await onSave(row, uplift.value, form.note.trim() || null);
    if (!saved) setSaving(false);
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!next && !saving) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit {row.mechanic_label}</DialogTitle>
          <DialogDescription>
            Saved as an Estimate. It no longer moves with the ordinary-month discount.
          </DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg border border-border p-4">
          {details.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="mt-0.5 font-medium">{value}</dd>
            </div>
          ))}
        </dl>

        <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="uplift-edit-value" className={labelClass}>Uplift (%)</label>
            <input
              id="uplift-edit-value"
              inputMode="decimal"
              value={form.uplift}
              disabled={saving}
              placeholder="e.g. 6 or -2"
              aria-invalid={Boolean(uplift.error)}
              onChange={(event) => setForm({ ...form, uplift: event.target.value })}
              className={inputClass}
            />
            {uplift.error ? (
              <p className={errorClass}>{uplift.error}</p>
            ) : (
              <p className={hintClass}>How much more (or less, with −) a month with this mechanic sells.</p>
            )}
          </div>
          <div>
            <label htmlFor="uplift-edit-note" className={labelClass}>Note (optional)</label>
            <input
              id="uplift-edit-note"
              value={form.note}
              disabled={saving}
              maxLength={1000}
              placeholder="Why this value"
              onChange={(event) => setForm({ ...form, note: event.target.value })}
              className={inputClass}
            />
          </div>

          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving || uplift.value == null}>
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
