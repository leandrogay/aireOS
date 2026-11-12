'use client';

import { useState } from 'react';
import { Check, CircleAlert, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { errorClass, hintClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui/formStyles';
import { customerLabel } from '@/app/utils/retailerLabel';
import { cn } from '@/lib/utils';

import CustomerSwatch from './CustomerSwatch';

/**
 * The swatch grid inside the dialog. Mounted fresh each time the dialog opens
 * (the parent keys it), so it always starts on the saved colour.
 */
function ColorForm({ customer, customers, choices, onSubmit, onCancel, onPendingChange }) {
  const [picked, setPicked] = useState(customer.color);
  const [requestError, setRequestError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const name = customerLabel(customer.customer_name);

  // A colour another customer has can't be picked: no two customers share one
  // (the backend also refuses one that only looks alike, with its reason).
  const owners = new Map(
    customers
      .filter((row) => row.customer_id !== customer.customer_id && row.color)
      .map((row) => [row.color, customerLabel(row.customer_name)]),
  );
  // The saved colour first, even when it is not one of the choices.
  const shown = customer.color && !choices.includes(customer.color) ? [customer.color, ...choices] : choices;

  function setPending(pending) {
    setSubmitting(pending);
    onPendingChange(pending);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!picked || picked === customer.color) {
      onCancel();
      return;
    }
    setRequestError('');
    setPending(true);
    try {
      await onSubmit(picked);
      onPendingChange(false);
    } catch (err) {
      // e.g. a 409: looks like a forecast line or another customer's colour.
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
          <p className="text-sm">Saving colour…</p>
        </div>
      )}

      {/* ==== Header ==== */}
      <div className="border-b border-lavander py-3 pl-4 pr-12">
        <h2 className="font-serif text-xl text-deep-violet-blue">Change colour — {name}</h2>
        <p className="mt-0.5 text-xs text-deep-violet-blue/65">
          {name} is drawn in this colour on every chart.
        </p>
      </div>

      <fieldset disabled={submitting} aria-busy={submitting} className="min-w-0 px-4 py-4">
        <legend className="sr-only">Chart colour</legend>
        <div role="radiogroup" aria-label="Chart colour" className="grid grid-cols-8 gap-2">
          {shown.map((color) => {
            const owner = owners.get(color);
            const selected = picked === color;
            return (
              <button
                key={color}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={owner ? `${color}, used by ${owner}` : color}
                title={owner ? `Used by ${owner}` : color}
                disabled={Boolean(owner)}
                onClick={() => {
                  setPicked(color);
                  setRequestError('');
                }}
                className={cn(
                  'flex aspect-square items-center justify-center rounded-full border border-deep-violet-blue/15 outline-none transition-transform focus-visible:ring-3 focus-visible:ring-ring/50',
                  selected && 'ring-2 ring-deep-violet-blue ring-offset-2',
                  owner ? 'cursor-not-allowed opacity-30' : 'cursor-pointer hover:scale-110',
                )}
                style={{ backgroundColor: color }}
              >
                {selected && <Check aria-hidden="true" className="size-4 text-white" />}
              </button>
            );
          })}
        </div>
        {/* One line is always reserved, so a message appears without moving the buttons. */}
        <div className="mt-2 min-h-4">
          {requestError ? (
            <p role="alert" className={cn(errorClass, 'mt-0 flex items-start gap-1 leading-4')}>
              <CircleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
              <span>{requestError}</span>
            </p>
          ) : (
            <p className={cn(hintClass, 'mt-0 flex items-center gap-1.5')}>
              <CustomerSwatch color={picked} />
              {picked ?? 'No colour yet'}. Faded colours belong to another customer.
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
          Save colour
        </Button>
      </div>
    </form>
  );
}

/**
 * Pick a customer's chart colour from the allowed set (backend
 * customer_colors.COLOR_CHOICES, sent with the customer list). Colours other
 * customers have are faded and can't be picked; the backend checks the pick
 * again and its 409 sentence is shown under the swatches. Cancel, Escape and
 * the backdrop close it with nothing sent, except while a save is in flight.
 *
 * @param {{
 *   customer: object | null,
 *   customers: object[],
 *   choices: string[],
 *   onSubmit: (color: string) => Promise<void>,
 *   onClose: () => void,
 * }} props
 */
export default function CustomerColorDialog({ customer, customers, choices, onSubmit, onClose }) {
  const [pending, setPending] = useState(false);

  function close() {
    if (pending) return;
    onClose();
  }

  return (
    <Dialog
      open={Boolean(customer)}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent aria-label="Change colour" className="bg-transparent p-0 ring-0 sm:max-w-md">
        {customer && (
          <ColorForm
            key={customer.customer_id}
            customer={customer}
            customers={customers}
            choices={choices}
            onSubmit={onSubmit}
            onCancel={close}
            onPendingChange={setPending}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
