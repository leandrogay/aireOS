'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { createInventoryRecord } from '@/app/services/inventoryApi';
import {
  buildInventoryPayload,
  formatMonth,
  isRowTouched,
  monthInputToDate,
  validateFinishedMonth,
  validateInventoryForm,
} from '@/app/utils/inventoryForm';

import CustomerDropdown from './CustomerDropdown';
import { formFieldClass, formLabelClass } from './InventoryChrome';
import InventoryQuantityTable, { INVENTORY_QUANTITY_COLUMNS } from './InventoryQuantityTable';
import { primaryButtonClass, secondaryButtonClass } from './formStyles';

const EMPTY_ROW = { sellIn: '', openingInventory: '', buildingBlocks: '' };

/**
 * One month of inventory for every catalog SKU, for one customer, entered as
 * a table instead of one SKU at a time -- the create form's old one-SKU-per-
 * submit flow meant repeating Customer/Month nine times over to log a single
 * month's data. Choosing the customer and month shows a row per SKU; only
 * rows with a sell-in entered are saved (a blank row is skipped, not an
 * error), each as its own request against the existing single-record
 * endpoint, so a conflict or missing sell-out data on one SKU does not block
 * the rest. A saved row is locked (the backend treats Create as insert-only;
 * fixing a mistake afterwards is what Edit is for).
 *
 * @param {object} props
 * @param {Array<{ customer_id: number, customer_name: string }>} props.customers
 * @param {Array<{ sku: string, product_name: string, sku_range: string | null }>} props.skus
 * @param {(message: string) => void} props.onSaved called with the confirmation text
 */
export default function InventoryBulkCreateForm({ customers, skus, onSaved }) {
  const [customerIds, setCustomerIds] = useState([]);
  const [month, setMonth] = useState('');
  const [rows, setRows] = useState({});
  const [rowErrors, setRowErrors] = useState({});
  const [savedSkus, setSavedSkus] = useState(new Set());
  const [topError, setTopError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const showTable = customerIds.length > 0 && Boolean(month);

  function resetTable() {
    setRows({});
    setRowErrors({});
    setSavedSkus(new Set());
    setTopError('');
  }

  function setRowField(sku, field, value) {
    setRows((current) => ({ ...current, [sku]: { ...(current[sku] ?? EMPTY_ROW), [field]: value } }));
    setRowErrors((current) => ({ ...current, [sku]: { ...current[sku], [field]: undefined, submit: undefined } }));
  }

  function handleCancel() {
    // Same as a full successful save: back to the blank picker, since
    // there's no "current customer/month" worth returning to here (unlike
    // Edit, which stays put to let a second correction follow the first).
    setCustomerIds([]);
    setMonth('');
    resetTable();
  }

  function validateRow(sku) {
    const row = rows[sku] ?? EMPTY_ROW;
    const found = validateInventoryForm({ customerIds, sku, month, ...row }, { isEdit: false });
    return { sellIn: found.sellIn, openingInventory: found.openingInventory, buildingBlocks: found.buildingBlocks };
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setTopError('');

    if (customerIds.length === 0) {
      setTopError('Choose a customer.');
      return;
    }
    const monthError = validateFinishedMonth(month);
    if (monthError) {
      setTopError(monthError);
      return;
    }

    const pendingSkus = skus
      .map((s) => s.sku)
      .filter((sku) => !savedSkus.has(sku) && isRowTouched(rows[sku] ?? EMPTY_ROW));
    if (pendingSkus.length === 0) {
      setTopError('Enter sell-in for at least one SKU.');
      return;
    }

    const nextRowErrors = {};
    let hasErrors = false;
    for (const sku of pendingSkus) {
      const found = validateRow(sku);
      if (found.sellIn || found.openingInventory || found.buildingBlocks) {
        nextRowErrors[sku] = found;
        hasErrors = true;
      }
    }
    if (hasErrors) {
      setRowErrors((current) => ({ ...current, ...nextRowErrors }));
      return;
    }

    setSubmitting(true);
    const outcomes = await Promise.allSettled(
      pendingSkus.map((sku) =>
        createInventoryRecord(buildInventoryPayload({ customerIds, sku, month, ...rows[sku] }, { isEdit: false })),
      ),
    );
    setSubmitting(false);

    let successCount = 0;
    const nextSaved = new Set();
    const nextErrors = {};
    outcomes.forEach((outcome, i) => {
      const sku = pendingSkus[i];
      if (outcome.status === 'fulfilled') {
        nextSaved.add(sku);
        successCount += 1;
      } else {
        nextErrors[sku] = { submit: outcome.reason?.message || 'Could not save this row.' };
      }
    });
    setSavedSkus((current) => new Set([...current, ...nextSaved]));
    setRowErrors((current) => ({ ...current, ...nextErrors }));

    const failCount = pendingSkus.length - successCount;
    if (failCount === 0) {
      onSaved(
        `Inventory data created for ${successCount} SKU${successCount === 1 ? '' : 's'} (${formatMonth(monthInputToDate(month))}).`,
      );
      setCustomerIds([]);
      setMonth('');
      resetTable();
    } else {
      setTopError(
        `${successCount} of ${pendingSkus.length} saved. Fix the highlighted row${failCount === 1 ? '' : 's'} and save again.`,
      );
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2 sm:max-w-xl">
        <CustomerDropdown
          customers={customers}
          customerIds={customerIds}
          onChange={(ids) => {
            setCustomerIds(ids);
            resetTable();
          }}
        />
        <label>
          <span className={formLabelClass}>
            Month<span className="text-red-700"> *</span>
          </span>
          <input
            type="month"
            value={month}
            onChange={(e) => {
              setMonth(e.target.value);
              resetTable();
            }}
            className={formFieldClass}
          />
        </label>
      </div>

      {showTable && (
        <InventoryQuantityTable
          rows={skus}
          columns={INVENTORY_QUANTITY_COLUMNS}
          values={rows}
          errors={rowErrors}
          savedSkus={savedSkus}
          disabledSkus={savedSkus}
          onFieldChange={setRowField}
        />
      )}

      {topError && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {topError}
        </p>
      )}

      {showTable && (
        <div className="flex gap-2">
          <Button type="submit" disabled={submitting} className={primaryButtonClass}>
            {submitting ? 'Saving…' : 'Create'}
          </Button>
          <Button type="button" variant="outline" onClick={handleCancel} disabled={submitting} className={secondaryButtonClass}>
            Cancel
          </Button>
        </div>
      )}
    </form>
  );
}
