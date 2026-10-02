'use client';

import { retailerLabel } from '@/app/utils/retailerLabel';
import { cn } from '@/lib/utils';

import { formFieldClass, formLabelClass } from './InventoryChrome';
import { invalidInputClass } from './formStyles';

/**
 * Customer picker, shared by the create form, the edit picker and temporary
 * sell-in. A plain single-select -- the backend still takes `customer_ids`
 * as a list, so this always sends either [] or exactly one id. The error
 * renders inside this label, like every other field, so a grid-layout parent
 * never has to add or remove a sibling grid item (and shift every field
 * after it) when the error toggles.
 *
 * @param {object} props
 * @param {Array<{ customer_id: number, customer_name: string }>} props.customers
 * @param {number[]} props.customerIds [] or a single selected id
 * @param {(customerIds: number[]) => void} props.onChange
 * @param {string} [props.error] shown under the field after a failed submit
 */
export default function CustomerDropdown({ customers, customerIds, onChange, error = '' }) {
  return (
    <label>
      <span className={formLabelClass}>
        Customer<span className="text-red-700"> *</span>
      </span>
      <select
        value={customerIds[0] ?? ''}
        onChange={(e) => onChange(e.target.value ? [Number(e.target.value)] : [])}
        aria-invalid={invalid}
        className={cn(formFieldClass, invalid && invalidInputClass)}
      >
        {/* Shown while nothing is chosen. Hidden so it is not a selectable option. */}
        <option value="" disabled hidden>
          Select a customer…
        </option>
        {customers.map((customer) => (
          <option key={customer.customer_id} value={customer.customer_id}>
            {retailerLabel(customer.customer_name)}
          </option>
        ))}
      </select>
      {error && <p className={errorClass} role="alert">{error}</p>}
    </label>
  );
}
