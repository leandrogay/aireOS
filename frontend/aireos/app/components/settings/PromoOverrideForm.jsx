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
import { addPromoUpliftOverride } from '@/app/services/promoUpliftsApi';
import { parseUpliftInput } from '@/app/utils/promoUpliftSettings';
import { retailerLabel } from '@/app/utils/retailerLabel';

const SCOPES = [
  { value: 'customer', label: 'Whole customer' },
  { value: 'range', label: 'One SKU range' },
  { value: 'sku', label: 'One SKU' },
];

/**
 * Give a mechanic its own value for one customer, SKU range or SKU (saved as
 * an Estimate). The Scenario builder then uses the most specific value.
 *
 * @param {object} props
 * @param {object[]} props.mechanics all-customers setting rows (one per mechanic)
 * @param {object[]} props.customers anchor rows ({ customer_id, customer_name })
 * @param {(result: object) => void} props.onSaved
 * @param {() => void} props.onCancel
 */
export default function PromoOverrideForm({ mechanics, customers, onSaved, onCancel }) {
  const [form, setForm] = useState({
    mechanicKey: mechanics[0]?.mechanic_key ?? '',
    customerId: customers[0]?.customer_id ?? '',
    scope: 'customer',
    target: '',
    uplift: '',
    note: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [requestError, setRequestError] = useState(null);
  const uplift = parseUpliftInput(form.uplift);
  const needsTarget = form.scope !== 'customer';
  const ready = uplift.value != null && form.mechanicKey && form.customerId !== '' && (!needsTarget || form.target.trim());

  function patch(changes) {
    setForm((current) => ({ ...current, ...changes }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!ready) return;
    setSubmitting(true);
    setRequestError(null);
    try {
      const result = await addPromoUpliftOverride({
        mechanic_key: form.mechanicKey,
        scope: form.scope,
        customer_id: Number(form.customerId),
        sku_range: form.scope === 'range' ? form.target.trim() : undefined,
        sku: form.scope === 'sku' ? form.target.trim() : undefined,
        uplift_pct: uplift.value,
        note: form.note.trim() || undefined,
      });
      onSaved(result);
    } catch (err) {
      setRequestError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className={cardClass}>
      <h3 className="text-sm font-medium text-deep-violet-blue">Add a value for one customer, range or SKU</h3>
      <p className={hintClass}>Saved as an Estimate. It does not move with the ordinary-month discount.</p>

      <fieldset disabled={submitting} className="mt-3 grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="override-mechanic" className={labelClass}>Mechanic</label>
          <select
            id="override-mechanic"
            value={form.mechanicKey}
            onChange={(e) => patch({ mechanicKey: e.target.value })}
            className={inputClass}
          >
            {mechanics.map((row) => (
              <option key={row.mechanic_key} value={row.mechanic_key}>{row.mechanic_label}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="override-customer" className={labelClass}>Customer</label>
          <select
            id="override-customer"
            value={form.customerId}
            onChange={(e) => patch({ customerId: e.target.value })}
            className={inputClass}
          >
            {customers.map((row) => (
              <option key={row.customer_id} value={row.customer_id}>{retailerLabel(row.customer_name)}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="override-scope" className={labelClass}>Applies to</label>
          <select
            id="override-scope"
            value={form.scope}
            onChange={(e) => patch({ scope: e.target.value, target: '' })}
            className={inputClass}
          >
            {SCOPES.map((scope) => (
              <option key={scope.value} value={scope.value}>{scope.label}</option>
            ))}
          </select>
        </div>
        {needsTarget ? (
          <div>
            <label htmlFor="override-target" className={labelClass}>
              {form.scope === 'range' ? 'SKU range' : 'SKU code'}
            </label>
            <input
              id="override-target"
              value={form.target}
              onChange={(e) => patch({ target: e.target.value })}
              className={inputClass}
            />
          </div>
        ) : null}
        <div>
          <label htmlFor="override-uplift" className={labelClass}>Uplift (%)</label>
          <input
            id="override-uplift"
            inputMode="decimal"
            value={form.uplift}
            placeholder="e.g. 6 or -2"
            onChange={(e) => patch({ uplift: e.target.value })}
            className={inputClass}
          />
          {form.uplift && uplift.error ? <p className={errorClass}>{uplift.error}</p> : null}
        </div>
        <div className={needsTarget ? '' : 'sm:col-span-2'}>
          <label htmlFor="override-note" className={labelClass}>Note (optional)</label>
          <input
            id="override-note"
            value={form.note}
            maxLength={1000}
            placeholder="Why this value"
            onChange={(e) => patch({ note: e.target.value })}
            className={inputClass}
          />
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
          <Button type="submit" disabled={submitting || !ready} className={primaryButtonClass}>
            {submitting ? 'Saving…' : 'Add value'}
          </Button>
        </div>
      </div>
    </form>
  );
}
