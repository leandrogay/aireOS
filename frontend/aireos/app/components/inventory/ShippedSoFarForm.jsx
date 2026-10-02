'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import useShippedSoFar from '@/hooks/useShippedSoFar';
import { setShippedSoFar } from '@/app/services/inventoryApi';
import {
  EMPTY_SHIPPED_FORM,
  buildShippedPayload,
  monthInputToDate,
  validateShippedForm,
} from '@/app/utils/inventoryForm';
import { retailerLabel } from '@/app/utils/retailerLabel';
import { cn } from '@/lib/utils';

import CustomerDropdown from './CustomerDropdown';
import { formFieldClass, formLabelClass } from './InventoryChrome';
import {
  errorClass,
  hintClass,
  invalidInputClass,
  primaryButtonClass,
} from './formStyles';

/**
 * Sell-in already sent for a SKU in a month that has not ended (for example a
 * top-up shipped because the customer reported low stock). It is not an
 * actual: it only feeds the sell-in plan, which takes it off what is still to
 * send and counts it towards the month's stock. Saving again replaces the
 * earlier figure and 0 clears it. When the month ends, enter its real totals
 * under Create or Edit.
 *
 * @param {object} props
 * @param {Array<{ customer_id: number, customer_name: string }>} props.customers
 * @param {Array<{ sku: string, product_name: string }>} props.skus
 * @param {(message: string) => void} props.onSaved called with the confirmation text
 */
export default function ShippedSoFarForm({ customers, skus, onSaved }) {
  const [form, setForm] = useState(EMPTY_SHIPPED_FORM);
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // What is already saved for this exact customer/SKU/month, so the user can
  // see the current number before overwriting it. Empty until all three are chosen.
  const allChosen = form.customerIds.length > 0 && Boolean(form.sku) && Boolean(form.month);
  const { data: current, loading: loadingCurrent } = useShippedSoFar({
    customerIds: form.customerIds,
    sku: form.sku,
    month: monthInputToDate(form.month),
  });
  // Gated on allChosen, not just `current`: the hook does not reset `data` when a
  // filter is cleared (see useShippedSoFar), so without this a stale value fetched
  // for an earlier, complete selection could leak into an incomplete one.
  const activeCurrent = allChosen ? current : null;
  // The lookup is a plain Cloud SQL read, usually fast, but the very first one in a
  // while (a cold Cloud SQL Connector handshake) can take a few seconds -- without
  // this, the field just sits blank with no sign anything is happening.
  const checkingCurrent = allChosen && loadingCurrent && !activeCurrent;

  // Fills the field with the current value the first time it resolves for a given
  // selection. Adjust state during render, not an effect: `appliedFor` tracks the
  // `current` array this was already applied for (a fresh array each fetch), so the
  // guard is false again as soon as the customer/SKU/month change and a new fetch
  // resolves, but stays false on every other render (e.g. the user editing the field).
  const [appliedFor, setAppliedFor] = useState(null);
  if (activeCurrent && activeCurrent !== appliedFor) {
    setAppliedFor(activeCurrent);
    if (activeCurrent.length > 0) {
      setForm((f) => ({ ...f, shippedSoFar: String(activeCurrent[0].shipped_so_far) }));
    }
  }

  const currentNote = activeCurrent?.length
    ? `Current temporary sell-in for ${retailerLabel(activeCurrent[0].customer_name)}: ${activeCurrent[0].shipped_so_far} units.`
    : '';

  function setField(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
    setErrors((current) => ({ ...current, [name]: undefined }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitError('');

    const found = validateShippedForm(form);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSubmitting(true);
    try {
      await setShippedSoFar(buildShippedPayload(form));
      onSaved('Temporary sell-in saved. The sell-in plan now counts it.');
    } catch (err) {
      setSubmitError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="grid gap-3 sm:grid-cols-2">
      <p className="text-sm text-deep-violet-blue/80 sm:col-span-2">
        Units already sent this month, before it has ended. This does not change actual stock. It only reduces what the
        sell-in plan recommends.
      </p>

      <CustomerDropdown
        customers={customers}
        customerIds={form.customerIds}
        onChange={(ids) => setField('customerIds', ids)}
        invalid={Boolean(errors.customerIds)}
      />
      {errors.customerIds && <p className={cn(errorClass, '-mt-2')} role="alert">{errors.customerIds}</p>}

      <label>
        <span className={formLabelClass}>
          SKU<span className="text-red-700"> *</span>
        </span>
        <select
          value={form.sku}
          onChange={(e) => setField('sku', e.target.value)}
          aria-invalid={Boolean(errors.sku)}
          className={cn(formFieldClass, errors.sku && invalidInputClass)}
        >
          <option value="" disabled hidden>
            Select a SKU…
          </option>
          {skus.map((s) => (
            <option key={s.sku} value={s.sku}>
              {s.product_name}
            </option>
          ))}
        </select>
        {errors.sku && <p className={errorClass} role="alert">{errors.sku}</p>}
      </label>

      <label>
        <span className={formLabelClass}>
          Month<span className="text-red-700"> *</span>
        </span>
        <input
          type="month"
          value={form.month}
          onChange={(e) => setField('month', e.target.value)}
          aria-invalid={Boolean(errors.month)}
          className={cn(formFieldClass, errors.month && invalidInputClass)}
        />
        {errors.month && <p className={errorClass} role="alert">{errors.month}</p>}
      </label>

      <label>
        <span className={formLabelClass}>
          Temporary sell-in (units)<span className="text-red-700"> *</span>
        </span>
        <input
          type="text"
          inputMode="numeric"
          value={form.shippedSoFar}
          onChange={(e) => setField('shippedSoFar', e.target.value)}
          aria-invalid={Boolean(errors.shippedSoFar)}
          className={cn(formFieldClass, errors.shippedSoFar && invalidInputClass)}
        />
        {errors.shippedSoFar ? (
          <p className={errorClass} role="alert">{errors.shippedSoFar}</p>
        ) : (
          <p className={hintClass}>
            {checkingCurrent
              ? 'Checking the current value…'
              : currentNote || 'The total sent so far for the month. Saving again replaces it; 0 clears it.'}
          </p>
        )}
      </label>

      {submitError && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 sm:col-span-2" role="alert">
          {submitError}
        </p>
      )}

      <div className="sm:col-span-2">
        <Button type="submit" disabled={submitting} className={primaryButtonClass}>
          {submitting ? 'Saving…' : 'Save temporary sell-in'}
        </Button>
      </div>
    </form>
  );
}
