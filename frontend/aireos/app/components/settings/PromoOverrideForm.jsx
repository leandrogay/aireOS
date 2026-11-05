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
import {
  errorClass,
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '@/components/ui/formStyles';
import { addPromoUpliftOverride } from '@/app/services/promoUpliftsApi';
import { overrideTargetChoices, parseUpliftInput } from '@/app/utils/promoUpliftSettings';
import { retailerLabel } from '@/app/utils/retailerLabel';

import RecommendedReadout from './RecommendedReadout';

const SCOPES = [
  { value: 'customer', label: 'Whole customer' },
  { value: 'range', label: 'One SKU range' },
  { value: 'sku', label: 'One SKU' },
];

/**
 * A dialog (like the anchor form) that gives a mechanic its own value for one
 * customer, SKU range or SKU (saved as an Estimate). The Scenario builder then uses the most specific value.
 *
 * @param {object} props
 * @param {object[]} props.mechanics all-customers setting rows (one per mechanic)
 * @param {object[]} props.customers anchor rows ({ customer_id, customer_name })
 * @param {{ skus: object[], loading: boolean, error: string | null }} props.catalog from useSkuCatalog
 * @param {object | null} props.moments from usePromoMoments, for the Moments / Recommended Uplift readout
 * @param {{ customer: string, sku: string, mechanic: string }} [props.initial] the table's filters, picked to start with
 * @param {(result: object) => void} props.onSaved
 * @param {() => void} props.onCancel
 */
export default function PromoOverrideForm({ mechanics, customers, catalog, moments, initial, onSaved, onCancel }) {
  const [form, setForm] = useState({
    mechanicKey: initial?.mechanic || (mechanics[0]?.mechanic_key ?? ''),
    customerId: (customers.find((row) => row.customer_name === initial?.customer) ?? customers[0])?.customer_id ?? '',
    scope: initial?.sku ? 'sku' : 'customer',
    target: initial?.sku ?? '',
    uplift: '',
    note: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [requestError, setRequestError] = useState(null);
  const choices = overrideTargetChoices(catalog.skus);
  const targetOptions =
    form.scope === 'range' ? choices.ranges.map((range) => ({ value: range, label: range })) : choices.skus;
  const uplift = parseUpliftInput(form.uplift);
  const needsTarget = form.scope !== 'customer';
  const ready = uplift.value != null && form.mechanicKey && form.customerId !== '' && (!needsTarget || form.target);

  let targetPrompt = form.scope === 'range' ? 'Choose a range' : 'Choose a SKU';
  if (catalog.loading) targetPrompt = 'Loading…';
  else if (!catalog.error && targetOptions.length === 0) targetPrompt = 'No SKUs in the catalog';

  // The readout waits until a range or SKU is picked, so it never shows the
  // whole customer's figures for a narrower value.
  const customerName = customers.find((row) => String(row.customer_id) === String(form.customerId))?.customer_name;
  const scopeRow =
    form.mechanicKey && customerName && (!needsTarget || form.target)
      ? {
          scope: form.scope,
          mechanic_key: form.mechanicKey,
          customer_name: customerName,
          sku_range: form.scope === 'range' ? form.target : null,
          sku: form.scope === 'sku' ? form.target : null,
        }
      : null;

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
        sku_range: form.scope === 'range' ? form.target : undefined,
        sku: form.scope === 'sku' ? form.target : undefined,
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
    <Dialog open onOpenChange={(next) => { if (!next && !submitting) onCancel(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add a value for one customer, range or SKU</DialogTitle>
          <DialogDescription>Saved as an Estimate. It does not move with the ordinary-month discount.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <RecommendedReadout scopeRow={scopeRow} moments={moments} />

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
                  {form.scope === 'range' ? 'SKU range' : 'SKU'}
                </label>
                <select
                  id="override-target"
                  value={form.target}
                  disabled={catalog.loading || targetOptions.length === 0}
                  onChange={(e) => patch({ target: e.target.value })}
                  className={inputClass}
                >
                  <option value="">{targetPrompt}</option>
                  {targetOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                {catalog.error ? <p className={errorClass}>{catalog.error}</p> : null}
              </div>
            ) : null}
            <div>
              <label htmlFor="override-uplift" className={labelClass}>Manual Uplift (%)</label>
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

          <DialogFooter className="mt-4 items-center sm:justify-between">
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
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
