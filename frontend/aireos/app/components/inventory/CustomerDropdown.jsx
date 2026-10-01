'use client';

import { retailerLabel } from '@/app/utils/retailerLabel';
import { cn } from '@/lib/utils';

import { inputClass, invalidInputClass, labelClass } from './formStyles';

/**
 * Customer picker, shared by the create form, the edit picker and temporary
 * sell-in. A plain single-select -- the backend still takes `customer_ids`
 * as a list, so this always sends either [] or exactly one id.
 *
 * @param {object} props
 * @param {Array<{ customer_id: number, customer_name: string }>} props.customers
 * @param {number[]} props.customerIds [] or a single selected id
 * @param {(customerIds: number[]) => void} props.onChange
 * @param {boolean} [props.invalid] red border after a failed submit
 */
export default function CustomerDropdown({ customers, customerIds, onChange, invalid = false }) {
  return (
    <label>
      <span className={labelClass}>
        Customer<span className="text-red-700"> *</span>
      </span>
      <select
        value={customerIds[0] ?? ''}
        onChange={(e) => onChange(e.target.value ? [Number(e.target.value)] : [])}
        aria-invalid={invalid}
        className={cn(inputClass, invalid && invalidInputClass)}
      >
        <option value="">Select a customer…</option>
        {customers.map((customer) => (
          <option key={customer.customer_id} value={customer.customer_id}>
            {retailerLabel(customer.customer_name)}
          </option>
        ))}
      </select>
    </label>
  );
}
