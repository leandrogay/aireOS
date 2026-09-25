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
import { cardClass, errorClass, inputClass, labelClass } from './formStyles';

/**
 * Create or edit inventory data, or record what has been shipped so far this
 * month (Shipped so far: sell-in already sent for a month that has not ended,
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
  const [formKey, setFormKey] = useState(0);

  function switchMode(next) {
    setMode(next);
    setRecord(null);
    setFormKey((key) => key + 1);
  }

  function handleSaved(message) {
    onSaved(message);
    // Back to a blank form (create) or the picker (edit) so a second save is deliberate.
    setRecord(null);
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
          Shipped so far
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
        />
      )}

      {mode === 'edit' && !record && (
        <RecordPicker customers={customers} skus={skus} onLoaded={setRecord} />
      )}
    </section>
  );
}

/**
 * Finds the record to edit: loads the customer, SKU and month through the
 * overview endpoint and hands the matching row on. A month with no data of its
 * own is refused here with a pointer to Create, mirroring the backend's 404.
 */
function RecordPicker({ customers, skus, onLoaded }) {
  const [customerId, setCustomerId] = useState('');
  const [sku, setSku] = useState('');
  const [month, setMonth] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLoad(event) {
    event.preventDefault();
    if (!customerId || !sku || !month) {
      setError('Choose a customer, a SKU and a month.');
      return;
    }

    setError('');
    setLoading(true);
    try {
      const monthDate = monthInputToDate(month);
      const overview = await getInventoryOverview({
        customerIds: [Number(customerId)],
        skus: [sku],
        startMonth: monthDate,
        endMonth: monthDate,
      });
      const row = overview.skus.find((r) => r.month === monthDate && r.has_data);
      if (!row) {
        setError('No inventory exists for that customer, SKU and month. Use Create to add it.');
        return;
      }
      onLoaded(formFromRow(row));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleLoad} className="grid gap-3 sm:grid-cols-3">
      <label>
        <span className={labelClass}>Customer</span>
        <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={inputClass}>
          <option value="">Select…</option>
          {customers.map((c) => (
            <option key={c.customer_id} value={c.customer_id}>
              {c.customer_name}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className={labelClass}>SKU</span>
        <select value={sku} onChange={(e) => setSku(e.target.value)} className={inputClass}>
          <option value="">Select…</option>
          {skus.map((s) => (
            <option key={s.sku} value={s.sku}>
              {s.product_name} ({s.sku})
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className={labelClass}>Month</span>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={inputClass} />
      </label>

      {error && <p className={cn(errorClass, 'sm:col-span-3')} role="alert">{error}</p>}

      <div className="sm:col-span-3">
        <Button type="submit" disabled={loading}>
          {loading ? 'Loading…' : 'Load record'}
        </Button>
      </div>
    </form>
  );
}
