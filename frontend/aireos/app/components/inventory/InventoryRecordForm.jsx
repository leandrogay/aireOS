'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { createInventoryRecord, updateInventoryRecord } from '@/app/services/inventoryApi';
import {
  buildInventoryPayload,
  validateInventoryForm,
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
  secondaryButtonClass,
} from './formStyles';

/**
 * One month of inventory for one SKU for the chosen customer. In edit mode
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
 */
export default function InventoryRecordForm({ mode, initialForm, customers, skus, onSaved, onCancel }) {
  const isEdit = mode === 'edit';
  const [form, setForm] = useState(initialForm);
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function setField(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
    setErrors((current) => ({ ...current, [name]: undefined }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitError('');

    const found = validateInventoryForm(form, { isEdit });
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSubmitting(true);
    try {
      const payload = buildInventoryPayload(form, { isEdit });
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
        <span className={formLabelClass}>
          {label}
          {required && <span className="text-red-700"> *</span>}
        </span>
        <input
          type="text"
          inputMode="numeric"
          value={form[name]}
          onChange={(e) => setField(name, e.target.value)}
          aria-invalid={Boolean(errors[name])}
          className={cn(formFieldClass, errors[name] && invalidInputClass)}
        />
        {errors[name] ? <p className={errorClass} role="alert">{errors[name]}</p> : hint && <p className={hintClass}>{hint}</p>}
      </label>
    );
  }

  const selectedNames = customers
    .filter((c) => form.customerIds.includes(c.customer_id))
    .map((c) => retailerLabel(c.customer_name))
    .join(', ');

  return (
    <form onSubmit={handleSubmit} noValidate className="grid gap-3 sm:grid-cols-2">
      {isEdit ? (
        <div>
          <span className={formLabelClass}>
            Customer<span className="text-red-700"> *</span>
          </span>
          <p className="text-sm text-deep-violet-blue">{selectedNames || '—'}</p>
        </div>
      ) : (
        <CustomerDropdown
          customers={customers}
          customerIds={form.customerIds}
          onChange={(ids) => setField('customerIds', ids)}
          invalid={Boolean(errors.customerIds)}
        />
      )}
      {!isEdit && errors.customerIds && (
        <p className={cn(errorClass, '-mt-2')} role="alert">{errors.customerIds}</p>
      )}

      <label>
        <span className={formLabelClass}>
          SKU<span className="text-red-700"> *</span>
        </span>
        <select
          value={form.sku}
          disabled={isEdit}
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
          disabled={isEdit}
          onChange={(e) => setField('month', e.target.value)}
          aria-invalid={Boolean(errors.month)}
          className={cn(formFieldClass, errors.month && invalidInputClass)}
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
      {numberField('buildingBlocks', 'Building blocks', {
        required: false,
        hint: 'Stock used for something other than sell-out (e.g. samples, internal use) that the sales data never sees. Subtracted from ending stock; blank counts as 0.',
      })}

      {submitError && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 sm:col-span-2" role="alert">
          {submitError}
        </p>
      )}

      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" disabled={submitting} className={primaryButtonClass}>
          {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Create'}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={submitting} className={secondaryButtonClass}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
