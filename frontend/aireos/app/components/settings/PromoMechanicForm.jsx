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
import { addPromoMechanic } from '@/app/services/promoUpliftsApi';
import { EMPTY_MECHANIC_FORM, validateMechanicForm } from '@/app/utils/promoUpliftSettings';
import { cn } from '@/lib/utils';

const KINDS = [
  { value: 'promotion', label: 'Promotion' },
  { value: 'voucher', label: 'Voucher' },
];

/**
 * Add a new promotion mechanic or voucher, with a value for all customers.
 * Customers and SKUs are never added here: they come from the catalogue
 * (Customers and SKUs pages) and reach this page's filters on their own.
 *
 * @param {object} props
 * @param {(save: Promise<object>) => Promise<object>} props.track counts the save as in flight (it may measure)
 * @param {(result: object) => void} props.onSaved
 * @param {() => void} props.onCancel
 */
export default function PromoMechanicForm({ track, onSaved, onCancel }) {
  const [form, setForm] = useState(EMPTY_MECHANIC_FORM);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [requestError, setRequestError] = useState(null);
  const isVoucher = form.kind === 'voucher';

  function change(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const { errors: nextErrors, payload } = validateMechanicForm(form);
    setErrors(nextErrors);
    if (!payload) return;
    setSubmitting(true);
    setRequestError(null);
    try {
      onSaved(await track(addPromoMechanic(payload)));
    } catch (err) {
      setRequestError(err.message);
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!next && !submitting) onCancel(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add promotion or voucher</DialogTitle>
          <DialogDescription>
            A new mechanic, with one value for every customer. It is offered in the Scenario builder straight away.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} noValidate className="grid gap-4">
          <fieldset disabled={submitting} className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <span className={labelClass}>Type</span>
              <div role="radiogroup" aria-label="Type" className="inline-flex rounded-lg border border-lavander p-0.5">
                {KINDS.map((kind) => (
                  <button
                    key={kind.value}
                    type="button"
                    role="radio"
                    aria-checked={form.kind === kind.value}
                    onClick={() => change('kind', kind.value)}
                    className={cn(
                      'rounded-md px-3 py-1 text-sm transition-colors',
                      form.kind === kind.value
                        ? 'bg-deep-violet-blue text-white'
                        : 'text-deep-violet-blue/70 hover:bg-cream'
                    )}
                  >
                    {kind.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="mechanic-label" className={labelClass}>Name</label>
              <input
                id="mechanic-label"
                value={form.label}
                maxLength={100}
                placeholder={isVoucher ? 'e.g. $5 off $50' : 'e.g. Buy 3 Get 1 Free'}
                aria-invalid={Boolean(errors.label)}
                onChange={(e) => change('label', e.target.value)}
                className={inputClass}
              />
              {errors.label ? <p className={errorClass}>{errors.label}</p> : null}
            </div>

            <div>
              <label htmlFor="mechanic-discount" className={labelClass}>
                Discount (%){isVoucher ? ' (optional)' : ''}
              </label>
              <input
                id="mechanic-discount"
                inputMode="decimal"
                value={form.discount}
                placeholder="e.g. 25"
                aria-invalid={Boolean(errors.discount)}
                onChange={(e) => change('discount', e.target.value)}
                className={inputClass}
              />
              {errors.discount ? (
                <p className={errorClass}>{errors.discount}</p>
              ) : (
                <p className={hintClass}>The effective discount, e.g. 33.3 for Buy 2 Get 1 Free.</p>
              )}
            </div>

            <div>
              <label htmlFor="mechanic-uplift" className={labelClass}>Uplift (%) (optional)</label>
              <input
                id="mechanic-uplift"
                inputMode="decimal"
                value={form.uplift}
                placeholder="e.g. 6 or -2"
                aria-invalid={Boolean(errors.uplift)}
                onChange={(e) => change('uplift', e.target.value)}
                className={inputClass}
              />
              {errors.uplift ? (
                <p className={errorClass}>{errors.uplift}</p>
              ) : (
                <p className={hintClass}>Leave empty for a rule-based uplift, which follows the rule and each customer&apos;s normal discount.</p>
              )}
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="mechanic-note" className={labelClass}>Note (optional)</label>
              <input
                id="mechanic-note"
                value={form.note}
                maxLength={1000}
                placeholder="Why this value"
                onChange={(e) => change('note', e.target.value)}
                className={inputClass}
              />
            </div>
          </fieldset>

          {requestError && (
            <p className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">{requestError}</p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>Cancel</Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Adding…' : isVoucher ? 'Add voucher' : 'Add promotion'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
