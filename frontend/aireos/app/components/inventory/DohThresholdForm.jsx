'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { setDohThresholds } from '@/app/services/inventoryApi';
import { buildThresholdPayload, validateThresholdForm } from '@/app/utils/inventoryForm';
import { cn } from '@/lib/utils';

import { checkRowClass, errorClass, hintClass, inputClass, invalidInputClass, labelClass } from './formStyles';

/**
 * Sets the target DOH for the chosen customers. Only the target is stored:
 * min and max are always the target -5 and +5 days, so they are shown but not
 * editable. Invalid fields are flagged before anything is sent.
 *
 * @param {object} props
 * @param {Array<{ customer_id: number, customer_name: string }>} props.customers
 * @param {(message: string) => void} props.onSaved called with the confirmation text
 */
export default function DohThresholdForm({ customers, onSaved }) {
  const [form, setForm] = useState({ customerIds: [], targetDoh: '' });
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function toggleCustomer(customerId) {
    const ids = form.customerIds.includes(customerId)
      ? form.customerIds.filter((id) => id !== customerId)
      : [...form.customerIds, customerId];
    setForm((current) => ({ ...current, customerIds: ids }));
    setErrors((current) => ({ ...current, customerIds: undefined }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitError('');

    const found = validateThresholdForm(form);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSubmitting(true);
    try {
      await setDohThresholds(buildThresholdPayload(form));
      setForm({ customerIds: [], targetDoh: '' });
      onSaved('Thresholds updated successfully');
    } catch (err) {
      setSubmitError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const target = /^\d+$/.test(form.targetDoh.trim()) ? Number(form.targetDoh) : null;

  return (
    <form onSubmit={handleSubmit} noValidate className="grid max-w-3xl gap-3 sm:grid-cols-2">
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
          Target DOH (days)<span className="text-red-700"> *</span>
        </span>
        <input
          type="text"
          inputMode="numeric"
          value={form.targetDoh}
          onChange={(e) => {
            setForm((current) => ({ ...current, targetDoh: e.target.value }));
            setErrors((current) => ({ ...current, targetDoh: undefined }));
          }}
          aria-invalid={Boolean(errors.targetDoh)}
          className={cn(inputClass, errors.targetDoh && invalidInputClass)}
        />
        {errors.targetDoh ? (
          <p className={errorClass} role="alert">{errors.targetDoh}</p>
        ) : (
          <p className={hintClass}>Whole days, 1 or more.</p>
        )}
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label>
          <span className={labelClass}>Min DOH</span>
          <input readOnly value={target === null ? '' : target - 5} className={cn(inputClass, 'opacity-70')} />
        </label>
        <label>
          <span className={labelClass}>Max DOH</span>
          <input readOnly value={target === null ? '' : target + 5} className={cn(inputClass, 'opacity-70')} />
        </label>
        <p className={cn(hintClass, 'col-span-2 mt-0')}>Min and max are always the target −5 and +5 days.</p>
      </div>

      {submitError && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 sm:col-span-2" role="alert">
          {submitError}
        </p>
      )}

      <div className="sm:col-span-2">
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Saving…' : 'Save thresholds'}
        </Button>
      </div>
    </form>
  );
}
