'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getInventoryOverview } from '@/app/services/inventoryApi';
import {
  EMPTY_INVENTORY_FORM,
  formFromRow,
  monthInputToDate,
} from '@/app/utils/inventoryForm';
import { retailerLabel } from '@/app/utils/retailerLabel';
import { cn } from '@/lib/utils';

import CustomerDropdown from './CustomerDropdown';
import InventoryRecordForm from './InventoryRecordForm';
import ShippedSoFarForm from './ShippedSoFarForm';
import { formFieldClass, formLabelClass } from './InventoryChrome';
import { errorClass, primaryButtonClass } from './formStyles';

const MODES = [
  { value: 'create', label: 'Create' },
  { value: 'edit', label: 'Edit' },
  { value: 'shipped', label: 'Temporary sell-in' },
];

const MODE_BUTTON_CLASS =
  'h-6 rounded-md px-2.5 text-[11px] text-deep-violet-blue/70 hover:text-deep-violet-blue';
const MODE_BUTTON_ACTIVE_CLASS = 'bg-deep-violet-blue text-white hover:bg-deep-violet-blue hover:text-white';

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
    <Card size="sm" className="rounded-lg border border-lavander bg-white text-deep-violet-blue shadow-sm ring-0">
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-1">
        <CardTitle className="font-serif text-base font-normal text-deep-violet-blue group-data-[size=sm]/card:text-base">
          Enter or edit data
        </CardTitle>
        <div className="inline-flex h-7 items-center rounded-lg bg-lavander p-0.5">
          {MODES.map((item) => (
            <Button
              key={item.value}
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => switchMode(item.value)}
              className={cn(MODE_BUTTON_CLASS, mode === item.value && MODE_BUTTON_ACTIVE_CLASS)}
            >
              {item.label}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="max-w-3xl">

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
    </CardContent>
    </Card>
  );
}

/**
 * Finds the record to edit: choose a customer, a SKU and a month, and the
 * existing record loads through the overview endpoint. Refused with an
 * explanation if that customer has no data for that SKU and month yet.
 */
function RecordPicker({ customers, skus, onLoaded }) {
  const [customerIds, setCustomerIds] = useState([]);
  const [sku, setSku] = useState('');
  const [month, setMonth] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLoad(event) {
    event.preventDefault();
    if (customerIds.length === 0 || !sku || !month) {
      setError('Choose a customer, a SKU and a month.');
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
      const row = overview.skus.find(
        (r) => r.customer_id === customerIds[0] && r.month === monthDate && r.has_data,
      );
      if (!row) {
        const customerName = customers.find((c) => c.customer_id === customerIds[0])?.customer_name;
        setError(`No inventory exists for ${retailerLabel(customerName)} for that SKU and month. Use Create to add it.`);
        return;
      }

      onLoaded({ ...formFromRow(row), customerIds });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleLoad} className="grid gap-3 sm:grid-cols-2">
      <CustomerDropdown customers={customers} customerIds={customerIds} onChange={setCustomerIds} />
      <label>
        <span className={formLabelClass}>SKU</span>
        <select value={sku} onChange={(e) => setSku(e.target.value)} className={formFieldClass}>
          <option value="">Select…</option>
          {skus.map((s) => (
            <option key={s.sku} value={s.sku}>
              {s.product_name}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className={formLabelClass}>Month</span>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={formFieldClass} />
      </label>

      {error && <p className={cn(errorClass, 'sm:col-span-2')} role="alert">{error}</p>}

      <div className="sm:col-span-2">
        <Button type="submit" disabled={loading} className={primaryButtonClass}>
          {loading ? 'Loading…' : 'Load record'}
        </Button>
      </div>
    </form>
  );
}
