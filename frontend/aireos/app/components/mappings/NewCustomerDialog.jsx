'use client';

import { useState } from 'react';
import { CircleAlert, Info, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import {
  checkRowClass,
  errorClass,
  hintClass,
  inputClass,
  invalidInputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '@/components/inventory/formStyles';
import { createCustomer } from '@/app/services/catalogApi';
import { normaliseName, validateName } from '@/app/utils/customerForm';
import { CHANNELS, channelRetailerName } from '@/app/utils/mappingCustomer';
import { retailerLabel } from '@/app/utils/retailerLabel';
import { cn } from '@/lib/utils';

/**
 * Where each retailer the form would create stands: free, already made by an
 * upload with no customer (linked, not duplicated -- backend
 * customer_service._attach_retailer), or another customer's (blocks).
 */
function plannedRetailers(name, channels, customers, unlinked) {
  const owner = new Map(
    customers.flatMap((customer) => customer.retailers.map((retailer) => [retailer.retailer_name, customer.customer_name])),
  );
  const loose = new Set(unlinked.map((retailer) => retailer.retailer_name));
  return channels.map((channel) => {
    const retailerName = channelRetailerName(name, channel);
    return { retailerName, owner: owner.get(retailerName) || null, unlinked: loose.has(retailerName) };
  });
}

/**
 * The form inside the dialog, mounted fresh on every open so it starts from
 * the suggestion each time.
 */
function NewCustomerForm({ defaults, customers, unlinked, onCreated, onCancel, onPendingChange }) {
  const [name, setName] = useState(defaults.name);
  const [channels, setChannels] = useState(defaults.channels);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [requestError, setRequestError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const takenNames = new Set(customers.map((customer) => normaliseName(customer.customer_name)));
  const nameError = validateName(name, takenNames, 'customer');
  const planned = nameError ? [] : plannedRetailers(name, channels, customers, unlinked);
  const owned = planned.filter((item) => item.owner);
  let channelError = '';
  if (!channels.length) channelError = 'Choose at least one channel.';
  else if (owned.length) {
    channelError = owned
      .map((item) => `${item.retailerName} already belongs to ${retailerLabel(item.owner)}.`)
      .join(' ');
  }

  function toggleChannel(channel) {
    setRequestError('');
    // Kept in CHANNELS order, so the retailers are listed the same way however
    // the boxes were ticked.
    setChannels((prev) =>
      CHANNELS.map((item) => item.value).filter((value) =>
        value === channel ? !prev.includes(value) : prev.includes(value),
      ),
    );
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitAttempted(true);
    setRequestError('');
    if (nameError || channelError) return;

    setSubmitting(true);
    onPendingChange(true);
    try {
      const customer = await createCustomer({
        customer_name: name.trim(),
        retailer_names: planned.map((item) => item.retailerName),
      });
      onPendingChange(false);
      onCreated(customer);
    } catch (err) {
      // e.g. a 409 for a name taken since the list loaded.
      setRequestError(err.message);
      setSubmitting(false);
      onPendingChange(false);
    }
  }

  const shownNameError = submitAttempted ? nameError : '';
  const shownChannelError = submitAttempted || owned.length ? channelError : '';

  return (
    <form noValidate onSubmit={handleSubmit} className="relative rounded-lg border border-lavander bg-white shadow-sm">
      {submitting && (
        <div
          role="status"
          aria-live="polite"
          className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-lg bg-white/70 text-deep-violet-blue/70 backdrop-blur-[1px]"
        >
          <Loader2 className="h-6 w-6 animate-spin" />
          <p className="text-sm">Creating customer…</p>
        </div>
      )}

      {/* ==== Header ==== */}
      <div className="border-b border-lavander py-3 pl-4 pr-12">
        <h2 className="font-serif text-xl text-deep-violet-blue">New customer</h2>
        <p className="mt-0.5 text-xs text-deep-violet-blue/65">
          Creates the customer and its retailers, the same as on the Customers page.
        </p>
      </div>

      <fieldset disabled={submitting} aria-busy={submitting} className="min-w-0 space-y-4 px-4 py-4">
        <div>
          <label htmlFor="new-customer-name" className={labelClass}>
            Customer name
            <span className="text-red-700" aria-hidden="true">
              {' '}
              *
            </span>
          </label>
          <input
            id="new-customer-name"
            type="text"
            autoFocus
            autoComplete="off"
            maxLength={255}
            value={name}
            placeholder="e.g. Giant"
            onChange={(event) => {
              setName(event.target.value);
              setRequestError('');
            }}
            aria-invalid={Boolean(shownNameError)}
            aria-describedby={shownNameError ? 'new-customer-name-error' : undefined}
            className={cn(inputClass, shownNameError && invalidInputClass)}
          />
          {shownNameError ? (
            <p id="new-customer-name-error" role="alert" className={errorClass}>
              {shownNameError}
            </p>
          ) : (
            !nameError && normaliseName(name) !== name.trim() && <p className={hintClass}>Saved as {normaliseName(name)}</p>
          )}
        </div>

        <div role="group" aria-labelledby="new-customer-channels">
          <p id="new-customer-channels" className={labelClass}>
            Where they sell
            <span className="text-red-700" aria-hidden="true">
              {' '}
              *
            </span>
          </p>
          <div className="grid gap-1 sm:grid-cols-2">
            {CHANNELS.map((channel) => (
              <label key={channel.value} className={cn(checkRowClass, 'border border-lavander')}>
                <input
                  type="checkbox"
                  checked={channels.includes(channel.value)}
                  onChange={() => toggleChannel(channel.value)}
                  className="size-4 accent-deep-violet-blue"
                />
                <span>
                  {channel.label}
                  <span className="block text-[11px] text-deep-violet-blue/60">{channel.help}</span>
                </span>
              </label>
            ))}
          </div>
          {shownChannelError && (
            <p role="alert" className={cn(errorClass, 'flex items-start gap-1')}>
              <CircleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
              {shownChannelError}
            </p>
          )}
        </div>

        {planned.length > 0 && !owned.length && (
          <div className="rounded-md border border-lavander bg-cream/60 p-2 text-xs text-deep-violet-blue">
            <p className="font-medium">Retailers this creates</p>
            <ul className="mt-1 space-y-0.5">
              {planned.map((item) => (
                <li key={item.retailerName}>
                  <span className="font-mono text-[11px]">{item.retailerName}</span>
                  {item.unlinked && (
                    <span className="text-deep-violet-blue/70"> — already made by an earlier upload; it will be linked</span>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-1.5 flex items-start gap-1 text-[11px] text-deep-violet-blue/60">
              <Info aria-hidden="true" className="mt-px size-3 shrink-0" />
              The Sales Dashboard finds a customer&apos;s sales through these names.
            </p>
          </div>
        )}

        {requestError && (
          <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
            {requestError}
          </p>
        )}
      </fieldset>

      {/* ==== Actions ==== */}
      <div className="flex items-center justify-end gap-2 rounded-b-lg border-t border-lavander bg-cream/40 px-4 py-3">
        <Button type="button" variant="outline" disabled={submitting} onClick={onCancel} className={secondaryButtonClass}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting} className={primaryButtonClass}>
          Create customer
        </Button>
      </div>
    </form>
  );
}

/**
 * Create a customer from the mapping review, with its online and/or offline
 * retailers, in one request (POST /api/catalog/customers with
 * retailer_names). Starts from what the file writes to: a file writing
 * `giant_offline` suggests "giant", Offline. Cancel, Escape and the backdrop
 * close it with nothing sent, except while the request is in flight.
 *
 * @param {{
 *   open: boolean,
 *   defaults: { name: string, channels: string[] },
 *   customers: object[],
 *   unlinked: object[],
 *   onCreated: (customer: object) => void,
 *   onClose: () => void,
 * }} props
 */
export default function NewCustomerDialog({ open, defaults, customers, unlinked, onCreated, onClose }) {
  const [pending, setPending] = useState(false);

  function close() {
    if (!pending) onClose();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent aria-label="New customer" className="bg-transparent p-0 ring-0 sm:max-w-md">
        {open && (
          <NewCustomerForm
            defaults={defaults}
            customers={customers}
            unlinked={unlinked}
            onCreated={onCreated}
            onCancel={close}
            onPendingChange={setPending}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
