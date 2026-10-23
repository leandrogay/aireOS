'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  cardClass,
  errorClass,
  hintClass,
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '@/components/inventory/formStyles';
import { savePromoAnchor } from '@/app/services/promoUpliftsApi';
import { anchorPreview, parseAnchorInput } from '@/app/utils/promoUpliftSettings';
import { formatPct } from '@/app/utils/scenarioPromotions';
import { cn } from '@/lib/utils';

/**
 * Edit one customer's ordinary-month discount (or the all-customers value),
 * with a live preview of how every placeholder uplift would shift before it
 * is saved. Values typed by hand on a mechanic do not move (they are not
 * placeholders), so they are not in the preview.
 *
 * @param {object} props
 * @param {{ key: string, customerId: number | null, name: string, anchorPct: number }} props.target
 * @param {object[]} props.settings current setting rows
 * @param {(result: object) => void} props.onSaved
 * @param {() => void} props.onCancel
 */
export default function PromoAnchorForm({ target, settings, onSaved, onCancel }) {
  const [text, setText] = useState(String(target.anchorPct));
  const [submitting, setSubmitting] = useState(false);
  const [requestError, setRequestError] = useState(null);
  const { value, error } = parseAnchorInput(text);
  const preview = anchorPreview(settings, target.anchorPct, value ?? target.anchorPct);

  async function handleSubmit(event) {
    event.preventDefault();
    if (value == null) return;
    setSubmitting(true);
    setRequestError(null);
    try {
      onSaved(await savePromoAnchor(target.customerId, value), target);
    } catch (err) {
      setRequestError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className={cardClass}>
      <h3 className="text-sm font-medium text-deep-violet-blue">Ordinary-month discount · {target.name}</h3>
      <p className={hintClass}>
        The discount an ordinary month already has: a mechanic at this discount counts as 0% uplift. Every 5 points
        deeper adds 2 points of uplift.
      </p>

      <fieldset disabled={submitting} className="mt-3 grid gap-3 sm:grid-cols-[11rem_1fr]">
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
        </div>

        <div className="overflow-auto rounded-md border border-lavander">
          <table className="w-full text-xs text-deep-violet-blue">
            <thead>
              <tr className="bg-lavander text-left">
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

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-red-700" role="status">
          {requestError}
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={submitting} className={secondaryButtonClass}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting || value == null} className={primaryButtonClass}>
            {submitting ? 'Saving…' : 'Save discount'}
          </Button>
        </div>
      </div>
    </form>
  );
}
