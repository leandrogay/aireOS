'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

import InventoryBulkCreateForm from './InventoryBulkCreateForm';
import InventoryBulkEditForm from './InventoryBulkEditForm';
import InventoryBulkShippedForm from './InventoryBulkShippedForm';
import SellInUploadForm from './SellInUploadForm';

const MODES = [
  { value: 'upload', label: 'Upload' },
  { value: 'create', label: 'Create' },
  { value: 'edit', label: 'Edit' },
  { value: 'shipped', label: 'Temporary sell-in' },
];

const MODE_BUTTON_CLASS = 'h-6 rounded-md px-2.5 text-[11px] text-deep-violet-blue/70 hover:text-deep-violet-blue';
const MODE_BUTTON_ACTIVE_CLASS = 'bg-deep-violet-blue text-white hover:bg-deep-violet-blue hover:text-white';

/**
 * Create or edit inventory data, record temporary sell-in for this month
 * (Temporary sell-in: sell-in already sent for a month that has not ended,
 * used only by the sell-in plan), or upload the sell-in tracker spreadsheet
 * (Upload: sell-in per customer, SKU and month). All three show every relevant SKU as a
 * table once a customer and month are chosen (InventoryBulkCreateForm /
 * InventoryBulkEditForm / InventoryBulkShippedForm) instead of one SKU at a
 * time: Create lists every catalog SKU, blank until touched; Edit lists only
 * the SKUs that already have data for that (finished) month, pre-filled with
 * their current figures; Temporary sell-in also lists every catalog SKU,
 * pre-filled with its current temporary figure, for the month still in
 * progress. Edit starts pre-loaded when reached from a table row's Edit
 * button (`editRow`).
 *
 * @param {object} props
 * @param {Array<{ customer_id: number, customer_name: string }>} props.customers
 * @param {Array<{ sku: string, product_name: string, sku_range: string | null }>} props.skus
 * @param {object | null} props.editRow table row chosen for editing, if any
 * @param {(message: string) => void} props.onSaved
 */
export default function InventoryDataManager({ customers, skus, editRow, onSaved }) {
  const [mode, setMode] = useState(editRow ? 'edit' : 'upload');
  // Remounts create to a blank form on a tab switch or a full save, so a
  // second create there is always deliberate. Edit and temporary sell-in
  // manage their own state across saves instead (they stay on the same
  // customer/month to let a second correction follow the first, since
  // neither is an insert-only operation) -- see InventoryBulkEditForm /
  // InventoryBulkShippedForm.
  const [resetKey, setResetKey] = useState(0);

  function switchMode(next) {
    setMode(next);
    setResetKey((key) => key + 1);
  }

  function handleCreateSaved(message) {
    onSaved(message);
    setResetKey((key) => key + 1);
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
      <CardContent className="max-w-4xl">
        {mode === 'create' && (
          <InventoryBulkCreateForm
            key={`create-${resetKey}`}
            customers={customers}
            skus={skus}
            onSaved={handleCreateSaved}
          />
        )}

        {mode === 'shipped' && <InventoryBulkShippedForm customers={customers} skus={skus} onSaved={onSaved} />}

        {mode === 'upload' && <SellInUploadForm onSaved={onSaved} />}

        {mode === 'edit' && (
          <InventoryBulkEditForm
            key={editRow ? `${editRow.customer_id}-${editRow.month}` : 'edit'}
            customers={customers}
            editRow={editRow}
            onSaved={onSaved}
          />
        )}
      </CardContent>
    </Card>
  );
}
