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
import { savePromoAnchor } from '@/app/services/promoUpliftsApi';
import { anchorPreview, anchorSourceLabel, changedByLabel, parseAnchorInput } from '@/app/utils/promoUpliftSettings';
import { formatDateTime } from '@/lib/formatDate';

import RulePreviewTable from './RulePreviewTable';

/**
 * Edit one customer's ordinary-month discount (or the all-customers value) in
 * a dialog (Edit details in the row's "..." menu): the row's details up top,
 * then the discount with a live preview of how every rule-based uplift would
 * shift before it is saved. Values typed by hand on a mechanic do not move
 * (they are not rule-based), so they are not in the preview.
 *
 * @param {object} props
 * @param {{ customerId: number | null, name: string, anchorPct: number, row: object | null }} props.target
 *   `row` is the anchor row from getPromoAnchors, null for the all-customers value
 * @param {object[]} props.settings current setting rows
 * @param {number} props.rate the rule's rate (% per point)
 * @param {(save: Promise<object>) => Promise<object>} props.track counts the save as in flight (it may measure)
 * @param {(result: object, target: object) => void} props.onSaved
 * @param {() => void} props.onCancel
 */
export default function PromoAnchorForm({ track, target, settings, rate, onSaved, onCancel }) {
  const [text, setText] = useState(String(target.anchorPct));
  const [submitting, setSubmitting] = useState(false);
  const [requestError, setRequestError] = useState(null);
  const { value, error } = parseAnchorInput(text);
  const preview = anchorPreview(settings, target.anchorPct, value ?? target.anchorPct, rate);
  const { row } = target;

  const details = row
    ? [
        ['Customer', target.name],
        ['Current discount', `${row.anchor_pct}%`],
        ['Source', anchorSourceLabel(row.source)],
        [
          'Suggested from data',
          row.suggested ? `${row.suggested.anchor_pct}% (median of ${row.suggested.months_used} months)` : 'No usable promotions yet',
        ],
        ['Last changed', row.changed_at ? `${formatDateTime(row.changed_at)} · ${changedByLabel(row.changed_by)}` : '—'],
      ]
    : [
        ['Applies to', 'Every customer with no promotions to suggest from'],
        ['Current discount', `${target.anchorPct}%`],
      ];

  async function handleSubmit(event) {
    event.preventDefault();
    if (value == null) return;
    setSubmitting(true);
    setRequestError(null);
    try {
      onSaved(await track(savePromoAnchor(target.customerId, value)), target);
    } catch (err) {
      setRequestError(err.message);
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!next && !submitting) onCancel(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Ordinary-month discount · {target.name}</DialogTitle>
          <DialogDescription>
            The discount an ordinary month already has: a mechanic at this discount counts as 0% uplift. Every 5 points
            deeper adds 2 points of uplift.
          </DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg border border-border p-4">
          {details.map(([label, detail]) => (
            <div key={label}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="mt-0.5 font-medium">{detail}</dd>
            </div>
          ))}
        </dl>

        <form onSubmit={handleSubmit} className="grid gap-4">
          <fieldset disabled={submitting} className="grid gap-4 sm:grid-cols-[11rem_1fr]">
            <div>
              <label htmlFor="anchor-pct" className={labelClass}>
                Discount (%)
              </label>
              <input
                id="anchor-pct"
                type="text"
                inputMode="decimal"
                value={text}
                onChange={(e) => setText(e.target.value)}
                aria-invalid={Boolean(error)}
                className={inputClass}
              />
              {error ? <p className={errorClass}>{error}</p> : <p className={hintClass}>Between 0 and 100.</p>}
            </div>

            <RulePreviewTable rows={preview} />
          </fieldset>

          {requestError && (
            <p className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">{requestError}</p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>Cancel</Button>
            <Button type="submit" disabled={submitting || value == null}>
              {submitting ? 'Saving…' : 'Save discount'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
