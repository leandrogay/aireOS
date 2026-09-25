'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { getInventoryOverview } from '@/app/services/inventoryApi';
import {
  EMPTY_INVENTORY_FORM,
  formFromRow,
  monthInputToDate,
} from '@/app/utils/inventoryForm';
import { cn } from '@/lib/utils';

import InventoryRecordForm from './InventoryRecordForm';
import ShippedSoFarForm from './ShippedSoFarForm';
import { cardClass, checkRowClass, errorClass, inputClass, labelClass } from './formStyles';

/**
 * Create or edit inventory data, or record temporary sell-in for this month
 * (Temporary sell-in: sell-in already sent for a month that has not ended,
 * used only by the sell-in plan). Create and Edit are for finished months. Edit starts either from a table row (its
 * Edit button passes `editRow`) or from a picker here: choose the customer,
 * SKU and month, and the existing record is loaded into the form.
 *
 * @param {object} props
 * @param {Array<{ customer_id: number, customer_name: string }>} props.customers
 * @param {Array<{ sku: string, product_name: string, sku_range: string | null }>} props.skus
 * @param {object | null} props.editRow table row chosen for editing, if any
 * @param {(message: string) => void} props.onSaved
 */
export default function InventoryDataManager({ customers, skus, editRow, onSaved }) {
  const [mode, setMode] = useState(editRow ? 'edit' : 'create');
  const [record, setRecord] = useState(editRow ? formFromRow(editRow) : null);
  const [notice, setNotice] = useState('');
  const [formKey, setFormKey] = useState(0);

  function handleLoaded(form, loadedNotice) {
    setRecord(form);
    setNotice(loadedNotice);
  }

  function switchMode(next) {
    setMode(next);
    setRecord(null);
    setNotice('');
    setFormKey((key) => key + 1);
  }

  function handleSaved(message) {
    onSaved(message);
    // Back to a blank form (create) or the picker (edit) so a second save is deliberate.
    setRecord(null);
    setNotice('');
    setFormKey((key) => key + 1);
  }

  return (
    <section className={cn(cardClass, 'max-w-3xl')}>
      <div className="mb-3 flex gap-2">
        <Button variant={mode === 'create' ? 'default' : 'outline'} size="sm" onClick={() => switchMode('create')}>
          Create
        </Button>
        <Button variant={mode === 'edit' ? 'default' : 'outline'} size="sm" onClick={() => switchMode('edit')}>
          Edit
        </Button>
        <Button variant={mode === 'shipped' ? 'default' : 'outline'} size="sm" onClick={() => switchMode('shipped')}>
          Temporary Sell-in
        </Button>
      </div>

      {mode === 'create' && (
        <InventoryRecordForm
          key={`create-${formKey}`}
          mode="create"
          initialForm={EMPTY_INVENTORY_FORM}
          customers={customers}
          skus={skus}
          onSaved={handleSaved}
        />
      )}

      {mode === 'shipped' && (
        <ShippedSoFarForm
          key={`shipped-${formKey}`}
          customers={customers}
          skus={skus}
          onSaved={handleSaved}
        />
      )}

      {mode === 'edit' && record && (
        <InventoryRecordForm
          key={`edit-${formKey}`}
          mode="edit"
          initialForm={record}
          customers={customers}
          skus={skus}
          onSaved={handleSaved}
          onCancel={() => switchMode('edit')}
          notice={notice}
        />
      )}

      {mode === 'edit' && !record && (
        <RecordPicker customers={customers} skus={skus} onLoaded={handleLoaded} />
      )}
    </section>
  );
}

/**
 * Finds the record to edit: choose one or more customers, a SKU and a month, and
 * the existing records load through the overview endpoint. Every chosen customer
 * must already have data for that month (the backend refuses otherwise, and this
 * says so first). The form is filled from the first customer; when the customers'
 * figures differ, a note says the saved value is applied to all of them.
 */
function RecordPicker({ customers, skus, onLoaded }) {
  const [customerIds, setCustomerIds] = useState([]);
  const [sku, setSku] = useState('');
  const [month, setMonth] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function toggleCustomer(customerId) {
    setCustomerIds((current) =>
      current.includes(customerId) ? current.filter((id) => id !== customerId) : [...current, customerId],
    );
  }

  async function handleLoad(event) {
    event.preventDefault();
    if (customerIds.length === 0 || !sku || !month) {
      setError('Choose at least one customer, a SKU and a month.');
      return;
    }

    setError('');
    setLoading(true);
    try {
      const monthDate = monthInputToDate(month);
      const overview = await getInventoryOverview({
        customerIds,
        skus: [sku],
        startMonth: monthDate,
        endMonth: monthDate,
      });
      const rows = customerIds.map((id) =>
        overview.skus.find((r) => r.customer_id === id && r.month === monthDate && r.has_data),
      );
      const missing = customers.filter((c) => customerIds.includes(c.customer_id) && !rows[customerIds.indexOf(c.customer_id)]);
      if (missing.length > 0) {
        setError(
          `No inventory exists for ${missing.map((c) => c.customer_name).join(', ')} for that SKU and month. Use Create to add it.`,
        );
        return;
      }

      const differs = rows.some((r) => r.sell_in !== rows[0].sell_in);
      onLoaded(
        { ...formFromRow(rows[0]), customerIds },
        customerIds.length > 1
          ? `The sell-in you save is applied to all ${customerIds.length} selected customers.${
              differs ? ' Their current sell-in figures differ; the form shows the first customer\'s.' : ''
            }`
          : '',
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleLoad} className="grid gap-3 sm:grid-cols-2">
      <fieldset className="sm:col-span-2">
        <legend className={labelClass}>Customers</legend>
        <div className="flex flex-wrap gap-x-4">
          {customers.map((customer) => (
            <label key={customer.customer_id} className={checkRowClass}>
              <input
                type="checkbox"
                checked={customerIds.includes(customer.customer_id)}
                onChange={() => toggleCustomer(customer.customer_id)}
                className="size-3.5 accent-deep-violet-blue"
              />
              {customer.customer_name}
            </label>
          ))}
        </div>
      </fieldset>
      <label>
        <span className={labelClass}>SKU</span>
        <select value={sku} onChange={(e) => setSku(e.target.value)} className={inputClass}>
          <option value="">Select…</option>
          {skus.map((s) => (
            <option key={s.sku} value={s.sku}>
              {s.product_name}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className={labelClass}>Month</span>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={inputClass} />
      </label>

      {error && <p className={cn(errorClass, 'sm:col-span-2')} role="alert">{error}</p>}

      <div className="sm:col-span-2">
        <Button type="submit" disabled={loading}>
          {loading ? 'Loading…' : 'Load record'}
        </Button>
      </div>
    </form>
  );
}
