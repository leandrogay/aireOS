'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { setShippedSoFar } from '@/app/services/inventoryApi';
import {
  EMPTY_SHIPPED_FORM,
  buildShippedPayload,
  validateShippedForm,
} from '@/app/utils/inventoryForm';
import { cn } from '@/lib/utils';

import {
  checkRowClass,
  errorClass,
  hintClass,
  inputClass,
  invalidInputClass,
  labelClass,
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

  function setField(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
    setErrors((current) => ({ ...current, [name]: undefined }));
  }

  function toggleCustomer(customerId) {
    const ids = form.customerIds.includes(customerId)
      ? form.customerIds.filter((id) => id !== customerId)
      : [...form.customerIds, customerId];
    setField('customerIds', ids);
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
      onSaved('Shipped so far saved. The sell-in plan now counts it.');
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

      <fieldset className="sm:col-span-2">
        <legend className={labelClass}>
          Customers<span className="text-red-700"> *</span>
        </legend>
        <div className="flex flex-wrap gap-x-4">
          {customers.map((customer) => (
            <label key={customer.customer_id} className={checkRowClass}>
              <input
                type="checkbox"
                checked={form.customerIds.includes(customer.customer_id)}
                onChange={() => toggleCustomer(customer.customer_id)}
                className="size-3.5 accent-deep-violet-blue"
              />
              {customer.customer_name}
            </label>
          ))}
        </div>
        {errors.customerIds && <p className={errorClass} role="alert">{errors.customerIds}</p>}
      </fieldset>

      <label>
        <span className={labelClass}>
          SKU<span className="text-red-700"> *</span>
        </span>
        <select
          value={form.sku}
          onChange={(e) => setField('sku', e.target.value)}
          aria-invalid={Boolean(errors.sku)}
          className={cn(inputClass, errors.sku && invalidInputClass)}
        >
          <option value="">Select a SKU…</option>
          {skus.map((s) => (
            <option key={s.sku} value={s.sku}>
              {s.product_name} ({s.sku})
            </option>
          ))}
        </select>
        {errors.sku && <p className={errorClass} role="alert">{errors.sku}</p>}
      </label>

      <label>
        <span className={labelClass}>
          Month<span className="text-red-700"> *</span>
        </span>
        <input
          type="month"
          value={form.month}
          onChange={(e) => setField('month', e.target.value)}
          aria-invalid={Boolean(errors.month)}
          className={cn(inputClass, errors.month && invalidInputClass)}
        />
        {errors.month && <p className={errorClass} role="alert">{errors.month}</p>}
      </label>

      <label>
        <span className={labelClass}>
          Shipped so far (units)<span className="text-red-700"> *</span>
        </span>
        <input
          type="text"
          inputMode="numeric"
          value={form.shippedSoFar}
          onChange={(e) => setField('shippedSoFar', e.target.value)}
          aria-invalid={Boolean(errors.shippedSoFar)}
          className={cn(inputClass, errors.shippedSoFar && invalidInputClass)}
        />
        {errors.shippedSoFar ? (
          <p className={errorClass} role="alert">{errors.shippedSoFar}</p>
        ) : (
          <p className={hintClass}>The total sent so far for the month. Saving again replaces it; 0 clears it.</p>
        )}
      </label>

      {submitError && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 sm:col-span-2" role="alert">
          {submitError}
        </p>
      )}

      <div className="sm:col-span-2">
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Saving…' : 'Save shipped so far'}
        </Button>
      </div>
    </form>
  );
}
