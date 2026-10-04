'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { getShippedSoFar, setShippedSoFar } from '@/app/services/inventoryApi';
import { buildShippedPayload, formatMonth, monthInputToDate, validateShippedForm } from '@/app/utils/inventoryForm';

import CustomerDropdown from './CustomerDropdown';
import { formFieldClass, formLabelClass } from './InventoryChrome';
import InventoryQuantityTable from './InventoryQuantityTable';
import { primaryButtonClass, secondaryButtonClass } from './formStyles';

const SHIPPED_COLUMNS = [
  {
    field: 'shippedSoFar',
    label: 'Temporary sell-in',
    required: true,
    hint: 'Units already sent this month, before it has ended. This does not change actual stock, only what the sell-in plan recommends. Saving again replaces the earlier figure; 0 clears it.',
  },
];

/**
 * Sell-in already sent for SKUs in a month that has not ended (for example a
 * top-up shipped because a customer reported low stock). It is not an
 * actual: it only feeds the sell-in plan, which takes it off what is still
 * to send and counts it towards the month's stock. Shown the same way as
 * create/edit -- choose a customer and month, then a table of every catalog
 * SKU, pre-filled with its current temporary sell-in (0 where nothing has
 * been entered, same as the backend treats it) -- except unlike create/edit,
 * the month does not have to be finished: this exists specifically for the
 * one still in progress. Only rows actually changed are saved, as
 * setShippedSoFar calls; it is a "set", not an insert, so a saved row's
 * inputs stay open for a further correction.
 *
 * @param {object} props
 * @param {Array<{ customer_id: number, customer_name: string }>} props.customers
 * @param {Array<{ sku: string, product_name: string }>} props.skus
 * @param {(message: string) => void} props.onSaved called with the confirmation text
 */
export default function InventoryBulkShippedForm({ customers, skus, onSaved }) {
  const [customerIds, setCustomerIds] = useState([]);
  const [month, setMonth] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [baseline, setBaseline] = useState({});
  const [values, setValues] = useState({});
  const [rowErrors, setRowErrors] = useState({});
  const [savedSkus, setSavedSkus] = useState(new Set());
  const [topError, setTopError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const showTable = customerIds.length > 0 && Boolean(month);

  useEffect(() => {
    if (!showTable) {
      setBaseline({});
      setValues({});
      setRowErrors({});
      setSavedSkus(new Set());
      setLoadError('');
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLoadError('');

    async function load() {
      const monthDate = monthInputToDate(month);
      const outcomes = await Promise.allSettled(
        skus.map((s) => getShippedSoFar({ customerIds, sku: s.sku, month: monthDate })),
      );
      if (cancelled) return;

      const nextBaseline = {};
      let failedCount = 0;
      outcomes.forEach((outcome, i) => {
        const sku = skus[i].sku;
        if (outcome.status === 'fulfilled') {
          const row = outcome.value.find((r) => r.customer_id === customerIds[0]);
          nextBaseline[sku] = { shippedSoFar: String(row?.shipped_so_far ?? 0) };
        } else {
          failedCount += 1;
        }
      });
      setBaseline(nextBaseline);
      setValues(nextBaseline);
      setRowErrors({});
      setSavedSkus(new Set());
      setLoadError(failedCount ? `Could not load the current value for ${failedCount} SKU(s). Try again.` : '');
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [customerIds, month, skus]);

  function isDirty(sku) {
    return values[sku]?.shippedSoFar !== baseline[sku]?.shippedSoFar;
  }

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
    setCustomerIds([]);
    setMonth('');
    setTopError('');
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setTopError('');

    if (customerIds.length === 0) {
      setTopError('Choose a customer.');
      return;
    }
    if (!/^\d{4}-\d{2}$/.test(month)) {
      setTopError('Choose a month.');
      return;
    }

    const dirtySkus = skus.map((s) => s.sku).filter(isDirty);
    if (dirtySkus.length === 0) {
      setTopError('Change at least one value before saving.');
      return;
    }

    const nextRowErrors = {};
    let hasErrors = false;
    for (const sku of dirtySkus) {
      const found = validateShippedForm({ customerIds, sku, month, shippedSoFar: values[sku].shippedSoFar });
      if (found.shippedSoFar) {
        nextRowErrors[sku] = { shippedSoFar: found.shippedSoFar };
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
        setShippedSoFar(buildShippedPayload({ customerIds, sku, month, shippedSoFar: values[sku].shippedSoFar })),
      ),
    );
    setSubmitting(false);

    let successCount = 0;
    const nextBaseline = { ...baseline };
    const nextSaved = new Set();
    const nextErrors = {};
    outcomes.forEach((outcome, i) => {
      const sku = dirtySkus[i];
      if (outcome.status === 'fulfilled') {
        nextBaseline[sku] = { ...values[sku] };
        nextSaved.add(sku);
        successCount += 1;
      } else {
        nextErrors[sku] = { submit: outcome.reason?.message || 'Could not save this row.' };
      }
    });
    setBaseline(nextBaseline);
    setSavedSkus((current) => new Set([...current, ...nextSaved]));
    setRowErrors((current) => ({ ...current, ...nextErrors }));

    const failCount = dirtySkus.length - successCount;
    if (failCount === 0) {
      onSaved(
        `Temporary sell-in saved for ${successCount} SKU${successCount === 1 ? '' : 's'} (${formatMonth(monthInputToDate(month))}). The sell-in plan now counts it.`,
      );
    } else {
      setTopError(
        `${successCount} of ${dirtySkus.length} saved. Fix the highlighted row${failCount === 1 ? '' : 's'} and save again.`,
      );
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-3">
      <p className="text-sm text-deep-violet-blue/80">
        Units already sent this month, before it has ended. This does not change actual stock. It only reduces what
        the sell-in plan recommends.
      </p>

      <div className="grid gap-3 sm:grid-cols-2 sm:max-w-xl">
        <CustomerDropdown customers={customers} customerIds={customerIds} onChange={setCustomerIds} />
        <label>
          <span className={formLabelClass}>
            Month<span className="text-red-700"> *</span>
          </span>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={formFieldClass} />
        </label>
      </div>

      {showTable && loading && <p className="text-sm text-deep-violet-blue/70">Loading…</p>}

      {showTable && !loading && loadError && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {loadError}
        </p>
      )}

      {showTable && !loading && (
        <InventoryQuantityTable
          rows={skus}
          columns={SHIPPED_COLUMNS}
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

      {showTable && !loading && (
        <div className="flex gap-2">
          <Button type="submit" disabled={submitting} className={primaryButtonClass}>
            {submitting ? 'Saving…' : 'Save temporary sell-in'}
          </Button>
          <Button type="button" variant="outline" onClick={handleCancel} disabled={submitting} className={secondaryButtonClass}>
            Cancel
          </Button>
        </div>
      )}
    </form>
  );
}
