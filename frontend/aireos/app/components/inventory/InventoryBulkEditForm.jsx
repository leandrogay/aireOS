'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { getInventoryOverview, updateInventoryRecord } from '@/app/services/inventoryApi';
import {
  buildInventoryPayload,
  formatMonth,
  monthInputToDate,
  sortSkusForEntry,
  validateFinishedMonth,
  validateInventoryForm,
} from '@/app/utils/inventoryForm';

import CustomerDropdown from './CustomerDropdown';
import { formFieldClass, formLabelClass } from './InventoryChrome';
import InventoryQuantityTable, { INVENTORY_QUANTITY_COLUMNS } from './InventoryQuantityTable';
import { primaryButtonClass, secondaryButtonClass } from './formStyles';

/**
 * @param {{ sell_in: number, building_blocks: number | null }} row
 */
function rowValues(row) {
  return {
    sellIn: String(row.sell_in),
    // Blank, not the current value: on edit, blank means "leave alone" (see
    // buildInventoryPayload) since opening inventory only ever applies to a
    // SKU's first month -- prefilling it here would make every save attempt
    // to re-set it.
    openingInventory: '',
    // Rounded up: this field is whole units only, so showing a historical
    // fractional figure would fail validation before the user ever touched
    // it. Rounds up, not to nearest, so stock on hand is never understated.
    buildingBlocks: String(Math.ceil(row.building_blocks ?? 0)),
  };
}

function isDirty(current, baseline) {
  return (
    current.sellIn !== baseline.sellIn || current.buildingBlocks !== baseline.buildingBlocks || current.openingInventory !== ''
  );
}

/**
 * Existing inventory data for one customer and month, shown as a table of
 * the SKUs that already have data for that month (unlike create, which
 * lists every catalog SKU) -- pre-filled with their current sell-in and
 * building blocks. Only rows actually changed from what was loaded are
 * saved, as updateInventoryRecord calls, so opening the form and saving
 * without touching anything does nothing. Unlike create, a saved row's
 * inputs stay open for a further correction instead of locking (update, not
 * insert, is what a second save on the same row does).
 *
 * @param {object} props
 * @param {Array<{ customer_id: number, customer_name: string }>} props.customers
 * @param {{ customer_id: number, month: string } | null} [props.editRow] pre-fills and loads straight away, e.g. from a table row's Edit button
 * @param {(message: string) => void} props.onSaved
 */
export default function InventoryBulkEditForm({ customers, editRow, onSaved }) {
  const [customerIds, setCustomerIds] = useState(editRow ? [editRow.customer_id] : []);
  const [month, setMonth] = useState(editRow ? editRow.month.slice(0, 7) : '');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [skuRows, setSkuRows] = useState([]);
  const [baseline, setBaseline] = useState({});
  const [values, setValues] = useState({});
  const [rowErrors, setRowErrors] = useState({});
  const [savedSkus, setSavedSkus] = useState(new Set());
  const [topError, setTopError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const showTable = customerIds.length > 0 && Boolean(month);

  function resetTable() {
    setSkuRows([]);
    setBaseline({});
    setValues({});
    setRowErrors({});
    setSavedSkus(new Set());
    setLoadError('');
  }

  useEffect(() => {
    // Resetting on a customer/month change happens eagerly in the field's
    // own onChange handler below (and in handleCancel), not here -- an
    // effect that just mirrors a condition into several setState calls
    // trips react-hooks/set-state-in-effect, and the fix is the same one
    // InventoryBulkCreateForm already uses.
    if (!showTable) return;

    let cancelled = false;

    async function load() {
      setLoading(true);
      setLoadError('');
      try {
        const monthDate = monthInputToDate(month);
        const overview = await getInventoryOverview({ customerIds, startMonth: monthDate, endMonth: monthDate });
        if (cancelled) return;
        const dataRows = sortSkusForEntry(
          overview.skus.filter((r) => r.customer_id === customerIds[0] && r.has_data),
        );
        const nextBaseline = {};
        const nextValues = {};
        dataRows.forEach((row) => {
          nextBaseline[row.sku] = rowValues(row);
          nextValues[row.sku] = rowValues(row);
        });
        setSkuRows(dataRows.map((r) => ({ sku: r.sku, product_name: r.product_name })));
        setBaseline(nextBaseline);
        setValues(nextValues);
        setRowErrors({});
        setSavedSkus(new Set());
      } catch (err) {
        if (!cancelled) setLoadError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [customerIds, month, showTable]);

  function setRowField(sku, field, value) {
    setValues((current) => ({ ...current, [sku]: { ...current[sku], [field]: value } }));
    setRowErrors((current) => ({ ...current, [sku]: { ...current[sku], [field]: undefined, submit: undefined } }));
    setSavedSkus((current) => {
      if (!current.has(sku)) return current;
      const next = new Set(current);
      next.delete(sku);
      return next;
    });
  }

  function handleCancel() {
    // Resetting customerIds/month (rather than just values) collapses the
    // table back to the picker, same as first opening Edit.
    setCustomerIds([]);
    setMonth('');
    resetTable();
    setTopError('');
  }

  function validateRow(sku) {
    const found = validateInventoryForm({ customerIds, sku, month, ...values[sku] }, { isEdit: true });
    return { sellIn: found.sellIn, openingInventory: found.openingInventory, buildingBlocks: found.buildingBlocks };
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setTopError('');

    const dirtySkus = skuRows.map((r) => r.sku).filter((sku) => isDirty(values[sku], baseline[sku]));
    if (dirtySkus.length === 0) {
      setTopError('Change at least one value before saving.');
      return;
    }

    const nextRowErrors = {};
    let hasErrors = false;
    for (const sku of dirtySkus) {
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
      dirtySkus.map((sku) =>
        updateInventoryRecord(buildInventoryPayload({ customerIds, sku, month, ...values[sku] }, { isEdit: true })),
      ),
    );
    setSubmitting(false);

    let successCount = 0;
    const nextBaseline = { ...baseline };
    const nextSaved = new Set();
    const nextErrors = {};
    const settledValues = {};
    outcomes.forEach((outcome, i) => {
      const sku = dirtySkus[i];
      if (outcome.status === 'fulfilled') {
        // Re-baseline to what was just saved, with opening inventory back to
        // blank (its baseline is always blank -- see rowValues).
        settledValues[sku] = { ...values[sku], openingInventory: '' };
        nextBaseline[sku] = settledValues[sku];
        nextSaved.add(sku);
        successCount += 1;
      } else {
        nextErrors[sku] = { submit: outcome.reason?.message || 'Could not save this row.' };
      }
    });
    setBaseline(nextBaseline);
    setValues((current) => ({ ...current, ...settledValues }));
    setSavedSkus((current) => new Set([...current, ...nextSaved]));
    setRowErrors((current) => ({ ...current, ...nextErrors }));

    const failCount = dirtySkus.length - successCount;
    if (failCount === 0) {
      onSaved(
        `Inventory data updated for ${successCount} SKU${successCount === 1 ? '' : 's'} (${formatMonth(monthInputToDate(month))}).`,
      );
    } else {
      setTopError(
        `${successCount} of ${dirtySkus.length} saved. Fix the highlighted row${failCount === 1 ? '' : 's'} and save again.`,
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

      {showTable && loading && <p className="text-sm text-deep-violet-blue/70">Loading…</p>}

      {showTable && !loading && loadError && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {loadError}
        </p>
      )}

      {showTable && !loading && !loadError && skuRows.length === 0 && (
        <p className="text-sm text-deep-violet-blue/70">
          No inventory data exists for this customer and month yet. Use Create to add it.
        </p>
      )}

      {showTable && !loading && skuRows.length > 0 && (
        <InventoryQuantityTable
          rows={skuRows}
          columns={INVENTORY_QUANTITY_COLUMNS}
          values={values}
          errors={rowErrors}
          savedSkus={savedSkus}
          onFieldChange={setRowField}
        />
      )}

      {topError && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {topError}
        </p>
      )}

      {showTable && !loading && skuRows.length > 0 && (
        <div className="flex gap-2">
          <Button type="submit" disabled={submitting} className={primaryButtonClass}>
            {submitting ? 'Saving…' : 'Save changes'}
          </Button>
          <Button type="button" variant="outline" onClick={handleCancel} disabled={submitting} className={secondaryButtonClass}>
            Cancel
          </Button>
        </div>
      )}
    </form>
  );
}
