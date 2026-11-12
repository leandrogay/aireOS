'use client';

import { customerLabel } from '@/app/utils/retailerLabel';
import SelectDropdown from '@/components/ui/SelectDropdown';

import { formLabelClass } from './InventoryChrome';
import { errorClass } from '@/components/ui/formStyles';

/**
 * Customer picker, shared by the create form, the edit picker and temporary
 * sell-in. The backend still takes `customer_ids` as a list, so this sends
 * either [] or exactly one id.
 *
 * @param {object} props
 * @param {Array<{ customer_id: number, customer_name: string }>} props.customers
 * @param {number[]} props.customerIds [] or a single selected id
 * @param {(customerIds: number[]) => void} props.onChange
 * @param {string} [props.error] shown under the field after a failed submit
 */
export default function CustomerDropdown({ customers, customerIds, onChange, error = '' }) {
  return (
    <div>
      <label htmlFor="inventory-customer" className={formLabelClass}>
        Customer<span className="text-red-700"> *</span>
      </label>
      <SelectDropdown
        id="inventory-customer"
        value={String(customerIds[0] ?? '')}
        onChange={(value) => onChange(value ? [Number(value)] : [])}
        options={customers.map((customer) => ({
          value: String(customer.customer_id),
          label: customerLabel(customer.customer_name),
        }))}
        placeholder="Select a customer…"
        ariaLabel="Customer"
        invalid={Boolean(error)}
      />
      {error && <p className={errorClass} role="alert">{error}</p>}
    </div>
  );
}
