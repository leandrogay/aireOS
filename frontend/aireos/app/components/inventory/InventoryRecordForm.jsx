'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { createInventoryRecord, updateInventoryRecord } from '@/app/services/inventoryApi';
import {
  buildInventoryPayload,
  validateInventoryForm,
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
 * One month of inventory for one SKU across the chosen customers. In edit mode
 * the customer, SKU and month are fixed (they identify the record) and only
 * the quantities change. Ending stock and DOH are never entered: they are
 * derived from these numbers, so an edit flows through every later month.
 * Only sell-in (and a first month's opening stock) is entered: sell-out comes
 * from the sales dashboard's data. Validation runs before submit; a server
 * refusal (duplicate month, sales data not loaded for that month, ...) is
 * shown as-is under the form.
 *
 * @param {object} props
 * @param {'create' | 'edit'} props.mode
 * @param {import('@/app/utils/inventoryForm').EMPTY_INVENTORY_FORM} props.initialForm
 * @param {Array<{ customer_id: number, customer_name: string }>} props.customers
 * @param {Array<{ sku: string, product_name: string, sku_range: string | null }>} props.skus
 * @param {(message: string) => void} props.onSaved called with the confirmation text
 * @param {() => void} [props.onCancel]
 * @param {string} [props.notice] a note shown above the buttons (edit: what several customers will receive)
 */
export default function InventoryRecordForm({ mode, initialForm, customers, skus, onSaved, onCancel, notice }) {
  const isEdit = mode === 'edit';
  const [form, setForm] = useState(initialForm);
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

    const found = validateInventoryForm(form, { isEdit });
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSubmitting(true);
    try {
      const payload = buildInventoryPayload(form);
      const save = isEdit ? updateInventoryRecord : createInventoryRecord;
      await save(payload);
      onSaved(isEdit ? 'Inventory data updated successfully.' : 'Inventory data created successfully.');
    } catch (err) {
      setSubmitError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  function numberField(name, label, { required = true, hint } = {}) {
    return (
      <label>
        <span className={labelClass}>
          {label}
          {required && <span className="text-red-700"> *</span>}
        </span>
        <input
          type="text"
          inputMode="numeric"
          value={form[name]}
          onChange={(e) => setField(name, e.target.value)}
          aria-invalid={Boolean(errors[name])}
          className={cn(inputClass, errors[name] && invalidInputClass)}
        />
        {errors[name] ? <p className={errorClass} role="alert">{errors[name]}</p> : hint && <p className={hintClass}>{hint}</p>}
      </label>
    );
  }

  const selectedNames = customers
    .filter((c) => form.customerIds.includes(c.customer_id))
    .map((c) => c.customer_name)
    .join(', ');

  return (
    <form onSubmit={handleSubmit} noValidate className="grid gap-3 sm:grid-cols-2">
      <fieldset className="sm:col-span-2">
        <legend className={labelClass}>
          Customer{(!isEdit || form.customerIds.length > 1) && 's'}
          <span className="text-red-700"> *</span>
        </legend>
        {isEdit ? (
          <p className="text-sm text-deep-violet-blue">{selectedNames || '—'}</p>
        ) : (
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
        )}
        {errors.customerIds && <p className={errorClass} role="alert">{errors.customerIds}</p>}
      </fieldset>

      <label>
        <span className={labelClass}>
          SKU<span className="text-red-700"> *</span>
        </span>
        <select
          value={form.sku}
          disabled={isEdit}
          onChange={(e) => setField('sku', e.target.value)}
          aria-invalid={Boolean(errors.sku)}
          className={cn(inputClass, errors.sku && invalidInputClass)}
        >
          <option value="">Select a SKU…</option>
          {skus.map((s) => (
            <option key={s.sku} value={s.sku}>
              {s.product_name}
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
          disabled={isEdit}
          onChange={(e) => setField('month', e.target.value)}
          aria-invalid={Boolean(errors.month)}
          className={cn(inputClass, errors.month && invalidInputClass)}
        />
        {errors.month ? (
          <p className={errorClass} role="alert">{errors.month}</p>
        ) : (
          <p className={hintClass}>Finished months only. For this month use Temporary sell-in.</p>
        )}
      </label>

      {numberField('sellIn', 'Sell-in (units received for the full month)', {
        hint: 'The total for the whole month, including any shipped mid-month.',
      })}
      {numberField('openingInventory', 'Opening inventory', {
        required: false,
        hint: "Only for a SKU's first month. Later months open at the previous ending stock.",
      })}

      <p className="text-sm text-deep-violet-blue/80 sm:col-span-2">
        Sell-out is not entered here. It comes from the sales dashboard&apos;s data for the month, so the two always
        agree.
      </p>

      {notice && (
        <p className="rounded-md border border-violet bg-lavander px-3 py-2 text-sm text-deep-violet-blue sm:col-span-2">
          {notice}
        </p>
      )}

      {submitError && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 sm:col-span-2" role="alert">
          {submitError}
        </p>
      )}

      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Create'}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
