'use client';

import { useState } from 'react';
import { CircleAlert, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import {
  errorClass,
  inputClass,
  invalidInputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '@/components/inventory/formStyles';
import { retailerLabel } from '@/app/utils/retailerLabel';
import { cn } from '@/lib/utils';

/**
 * @param {{
 *   retailer: object,
 *   customers: object[],
 *   onSubmit: (customerId: number) => Promise<void>,
 *   onCancel: () => void,
 *   onPendingChange: (pending: boolean) => void,
 * }} props
 */
function LinkForm({ retailer, customers, onSubmit, onCancel, onPendingChange }) {
  const [customerId, setCustomerId] = useState('');
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [requestError, setRequestError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const message = (submitAttempted && !customerId ? 'Choose a customer.' : '') || requestError;

  function setPending(pending) {
    setSubmitting(pending);
    onPendingChange(pending);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitAttempted(true);
    setRequestError('');
    if (!customerId) return;

    setPending(true);
    try {
      await onSubmit(Number(customerId));
      onPendingChange(false);
    } catch (err) {
      setRequestError(err.message);
      setPending(false);
    }
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="relative rounded-lg border border-lavander bg-white shadow-sm">
      {submitting && (
        <div
          role="status"
          aria-live="polite"
          className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-lg bg-white/70 text-deep-violet-blue/70 backdrop-blur-[1px]"
        >
          <Loader2 className="h-6 w-6 animate-spin" />
          <p className="text-sm">Linking retailer…</p>
        </div>
      )}

      {/* ==== Header ==== */}
      <div className="border-b border-lavander py-3 pl-4 pr-12">
        <h2 className="font-serif text-xl text-deep-violet-blue">Link {retailerLabel(retailer.retailer_name)}</h2>
        <p className="mt-0.5 text-xs text-deep-violet-blue/65">Choose the customer this retailer belongs to.</p>
      </div>

      <fieldset disabled={submitting} aria-busy={submitting} className="min-w-0 px-4 py-4">
        <label htmlFor="link-retailer-customer" className={labelClass}>
          Customer
          <span className="text-red-700" aria-hidden="true">
            {' '}
            *
          </span>
        </label>
        <select
          id="link-retailer-customer"
          value={customerId}
          onChange={(event) => {
            setCustomerId(event.target.value);
            setRequestError('');
          }}
          aria-invalid={Boolean(message)}
          aria-describedby={message ? 'link-retailer-error' : undefined}
          className={cn(inputClass, message && invalidInputClass)}
        >
          <option value="">Choose a customer…</option>
          {customers.map((customer) => (
            <option key={customer.customer_id} value={customer.customer_id}>
              {retailerLabel(customer.customer_name)}
            </option>
          ))}
        </select>
        <div className="mt-1 min-h-4">
          {message && (
            <p id="link-retailer-error" role="alert" className={cn(errorClass, 'mt-0 flex items-start gap-1 leading-4')}>
              <CircleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
              <span>{message}</span>
            </p>
          )}
        </div>
      </fieldset>

      {/* ==== Actions ==== */}
      <div className="flex items-center justify-end gap-2 rounded-b-lg border-t border-lavander bg-cream/40 px-4 py-3">
        <Button type="button" variant="outline" disabled={submitting} onClick={onCancel} className={secondaryButtonClass}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting} className={primaryButtonClass}>
          Link retailer
        </Button>
      </div>
    </form>
  );
}

/**
 * Gives a retailer that has no customer yet (created by name by a promotion
 * or an upload) its customer: PUT /api/catalog/retailers/{id}/customer.
 *
 * @param {{
 *   retailer: object | null,
 *   customers: object[],
 *   onSubmit: (customerId: number) => Promise<void>,
 *   onClose: () => void,
 * }} props
 */
export default function LinkRetailerDialog({ retailer, customers, onSubmit, onClose }) {
  const [pending, setPending] = useState(false);

  function close() {
    if (pending) return;
    onClose();
  }

  return (
    <Dialog
      open={Boolean(retailer)}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent aria-label="Link retailer to a customer" className="bg-transparent p-0 ring-0 sm:max-w-md">
        {retailer && (
          <LinkForm
            key={retailer.retailer_id}
            retailer={retailer}
            customers={customers}
            onSubmit={onSubmit}
            onCancel={close}
            onPendingChange={setPending}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
