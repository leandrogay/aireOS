'use client';

import { Check } from 'lucide-react';

import { cn } from '@/lib/utils';

import InfoTooltip from './InfoTooltip';
import { inventoryRowClass, inventoryTdClass, inventoryThClass } from './InventoryTableFrame';
import { invalidInputClass } from './formStyles';
import { formFieldClass } from './InventoryChrome';

/**
 * The three quantity columns the create and edit tables share. Temporary
 * sell-in passes its own single-column list instead (see
 * InventoryBulkShippedForm) since it has nothing to do with opening
 * inventory or building blocks.
 */
export const INVENTORY_QUANTITY_COLUMNS = [
  {
    field: 'sellIn',
    label: 'Sell-in',
    required: true,
    hint: 'The total for the whole month, including any shipped mid-month.',
  },
  {
    field: 'openingInventory',
    label: 'Opening inventory',
    hint: "Only for a SKU's first month. Later months open at the previous ending stock.",
  },
  {
    field: 'buildingBlocks',
    label: 'Building blocks',
    hint: 'Stock used for something other than sell-out (e.g. samples, internal use) that the sales data never sees. Subtracted from ending stock; blank counts as 0.',
  },
];

// Quantity-column errors float beside the field (over the next column,
// never below) without taking up flow space, so a row's height never
// depends on how many lines the message wraps to -- which varies by the
// text itself and the column's actual width on screen, neither knowable
// ahead of time. Capped to 2 lines (line-clamp) so a long backend message
// (a conflict or sell-out-coverage error, unlike the short client
// validation ones, has no length limit) still stays small -- the full text
// is there via the title tooltip either way.
//
// bg-white matches the row's own background, opaque so it still occludes
// whatever it overlaps (it has to -- it's covering live content, not empty
// space), and no border/radius/shadow so it reads as text sitting on the
// table rather than a separate floating card. group-hover (the <tr> below
// is marked "group") tracks the row's own hover tint, since this always
// overlaps its own row. The hover colour is the flat #F5F2EF, not
// bg-cream/50: this element paints on top of the row, which already
// carries that same translucent tint, so a second translucent layer on
// top of it would compound into something more saturated than the row's
// own single layer -- a flat, opaque colour can't compound no matter how
// many layers it sits on.
//
// The Status column's own error (submitError, rendered further below)
// takes a different approach: it's the last column, so "float beside" has
// nowhere to go, and floating below would land over the *next* row rather
// than its own -- there's no plain-CSS way to track that other row's
// hover state, so it would always risk a mismatched background. It
// renders in-flow instead, growing its own row on a failed save, which is
// the simpler, honestly-correct trade-off for that one case.
const FLOATING_ERROR_RIGHT_CLASS =
  'absolute left-full top-1/2 z-10 ml-2 w-56 -translate-y-1/2 line-clamp-2 bg-white py-1 text-xs text-red-700 group-hover:bg-[#F5F2EF]';

/**
 * One row per SKU, with one input column per entry in `columns`, each with
 * an info popover on its header instead of a hint under every input. Shared
 * by the bulk create, bulk edit and bulk temporary-sell-in forms, which
 * differ in which SKUs they list, which columns they need, what the inputs
 * start out holding, and what "Saved" means afterwards (locked for create,
 * still editable for edit/temporary sell-in) -- all of that is the caller's
 * job, this just renders the grid.
 *
 * @param {object} props
 * @param {Array<{ sku: string, product_name: string }>} props.rows
 * @param {Array<{ field: string, label: string, hint: string, required?: boolean }>} props.columns
 * @param {Record<string, Record<string, string>>} props.values keyed by sku, then column field
 * @param {Record<string, Record<string, string> & { submit?: string }>} props.errors keyed by sku, then column field or 'submit'
 * @param {Set<string>} [props.savedSkus] shows a "Saved" check for these SKUs
 * @param {Set<string>} [props.disabledSkus] greys out and disables these SKUs' inputs
 * @param {(sku: string, field: string, value: string) => void} props.onFieldChange
 */
export default function InventoryQuantityTable({
  rows,
  columns,
  values,
  errors,
  savedSkus = new Set(),
  disabledSkus = new Set(),
  onFieldChange,
}) {
  function numberCell(sku, field, disabled) {
    const error = errors[sku]?.[field];
    return (
      <td key={field} className={inventoryTdClass}>
        {/* The positioning anchor is this input-sized wrapper, not the td
            (which is as wide as the whole column) -- otherwise "beside the
            field" would land wherever the column happens to end, not next
            to the input itself. */}
        <span className="relative inline-block">
          <input
            type="text"
            inputMode="numeric"
            value={values[sku]?.[field] ?? ''}
            onChange={(e) => onFieldChange(sku, field, e.target.value)}
            disabled={disabled}
            aria-invalid={Boolean(error)}
            className={cn(formFieldClass, 'w-24', error && invalidInputClass)}
          />
          {error && (
            <p className={FLOATING_ERROR_RIGHT_CLASS} role="alert" title={error}>
              {error}
            </p>
          )}
        </span>
      </td>
    );
  }

  return (
    <div className="max-h-[32rem] overflow-auto rounded-md border border-lavander">
      <table className="w-full border-collapse text-left text-xs text-deep-violet-blue">
        <thead className="sticky top-0 z-10 bg-cream">
          <tr className="border-b border-lavander">
            <th className={inventoryThClass}>Product</th>
            {columns.map((col) => (
              <th key={col.field} className={inventoryThClass}>
                <span className="inline-flex items-center gap-1">
                  {col.label}
                  {col.required && <span className="text-red-700">*</span>}
                  <InfoTooltip label={`About ${col.label.toLowerCase()}`}>{col.hint}</InfoTooltip>
                </span>
              </th>
            ))}
            <th className={cn(inventoryThClass, 'min-w-48')}>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const saved = savedSkus.has(row.sku);
            const disabled = disabledSkus.has(row.sku);
            const submitError = errors[row.sku]?.submit;
            return (
              <tr key={row.sku} className={cn(inventoryRowClass, 'group')}>
                <td className={cn(inventoryTdClass, 'font-medium')}>{row.product_name}</td>
                {columns.map((col) => numberCell(row.sku, col.field, disabled))}
                <td className={inventoryTdClass}>
                  {saved && (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                      <Check className="size-3.5" /> Saved
                    </span>
                  )}
                  {submitError && (
                    <p className="line-clamp-3 text-xs text-red-700" role="alert" title={submitError}>
                      {submitError}
                    </p>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
