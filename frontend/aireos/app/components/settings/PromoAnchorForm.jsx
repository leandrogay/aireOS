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
import { errorClass, hintClass, inputClass, labelClass } from '@/components/ui/formStyles';
import { saveFallbackAnchor } from '@/app/services/promoUpliftsApi';
import { anchorPreview, parseAnchorInput } from '@/app/utils/promoUpliftSettings';
import { formatPct } from '@/app/utils/scenarioPromotions';
import { cn } from '@/lib/utils';

/**
 * Type the fallback anchor: the ordinary-month discount of every customer x
 * SKU range with no anchor of its own or its customer's (20% until changed).
 * It applies from this month; past months keep theirs. A live preview shows
 * how each mechanic's placeholder uplift would shift before it is saved.
 * Customer and range anchors are never typed: they are overwritten with a
 * mechanic (PromoAnchorOverwriteForm). A dialog, opened from the fallback
 * line under the anchor table.
 *
 * @param {object} props
 * @param {number} props.anchorPct the fallback now
 * @param {object[]} props.settings current setting rows
 * @param {(result: object) => void} props.onSaved
 * @param {() => void} props.onCancel
 */
export default function PromoAnchorForm({ anchorPct, settings, onSaved, onCancel }) {
  const [text, setText] = useState(String(anchorPct));
  const [submitting, setSubmitting] = useState(false);
  const [requestError, setRequestError] = useState(null);
  const { value, error } = parseAnchorInput(text);
  const preview = anchorPreview(settings, anchorPct, value ?? anchorPct);

  async function handleSubmit(event) {
    event.preventDefault();
    if (value == null) return;
    setSubmitting(true);
    setRequestError(null);
    try {
      onSaved(await saveFallbackAnchor(value));
    } catch (err) {
      setRequestError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!next && !submitting) onCancel(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Fallback anchor</DialogTitle>
          <DialogDescription>
            Used wherever a customer or SKU range has no anchor of its own. A mechanic at this discount counts as 0%
            uplift; every 5 points deeper adds 2 points of uplift.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <fieldset disabled={submitting} className="grid gap-3 sm:grid-cols-[11rem_1fr]">
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
              {error ? <p className={errorClass}>{error}</p> : null}
              <p className={hintClass}>Applies from this month; past months keep theirs.</p>
            </div>

            <div className="overflow-auto rounded-md border border-lavander">
              <table className="w-full text-xs text-deep-violet-blue">
                <thead>
                  <tr className="bg-cream text-left">
                    <th className="px-2 py-1 font-semibold">Placeholder mechanic</th>
                    <th className="px-2 py-1 text-right font-semibold">Now</th>
                    <th className="px-2 py-1 text-right font-semibold">After</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((row) => (
                    <tr key={row.mechanicKey} className="border-t border-lavander">
                      <td className="px-2 py-1">{row.label}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{formatPct(row.before)}</td>
                      <td className={cn('px-2 py-1 text-right tabular-nums', row.after !== row.before && 'font-semibold')}>
                        {formatPct(row.after)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </fieldset>

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
