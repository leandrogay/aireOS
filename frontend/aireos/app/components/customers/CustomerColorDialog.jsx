'use client';

import { useState } from 'react';
import { CircleAlert, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { errorClass, hintClass, labelClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui/formStyles';
import { hexToHsl, hslToHex } from '@/app/utils/colorWheel';
import { customerLabel } from '@/app/utils/retailerLabel';
import { cn } from '@/lib/utils';

import ColorWheel from './ColorWheel';
import CustomerSwatch from './CustomerSwatch';

// A customer with no colour yet starts the wheel on the AIRE violet.
const START_COLOR = '#7A70B8';

/**
 * The wheel inside the dialog. Mounted fresh each time the dialog opens (the
 * parent keys it), so it always starts on the saved colour.
 */
function ColorForm({ customer, customers, onSubmit, onCancel, onPendingChange }) {
  const [hsl, setHsl] = useState(() => hexToHsl(customer.color ?? START_COLOR));
  // The wheel works in whole degrees and percents, so the saved colour may
  // come back a step off: only a colour the user moved counts as a change.
  const [moved, setMoved] = useState(false);
  const [requestError, setRequestError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const name = customerLabel(customer.customer_name);
  const picked = moved ? hslToHex(hsl) : (customer.color ?? hslToHex(hsl));

  // The other customers' colours, to keep clear of (the backend refuses one
  // that looks too alike, with its reason).
  const others = customers.filter((row) => row.customer_id !== customer.customer_id && row.color);

  function setPending(pending) {
    setSubmitting(pending);
    onPendingChange(pending);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (picked === customer.color) {
      onCancel();
      return;
    }
    setRequestError('');
    setPending(true);
    try {
      await onSubmit(picked);
      onPendingChange(false);
    } catch (err) {
      // e.g. a 409: looks like another customer's colour.
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
        <ColorWheel
          value={hsl}
          onChange={(next) => {
            setHsl(next);
            setMoved(true);
            setRequestError('');
          }}
        />

        {others.length > 0 && (
          <div className="mt-4">
            <p className={labelClass}>Other customers</p>
            <ul className="flex flex-wrap gap-x-3 gap-y-1.5">
              {others.map((row) => (
                <li key={row.customer_id} className="flex items-center gap-1.5 text-xs text-deep-violet-blue/80">
                  <CustomerSwatch color={row.color} />
                  {customerLabel(row.customer_name)}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* One line is always reserved, so a message appears without moving the buttons. */}
        <div className="mt-3 min-h-4">
          {requestError ? (
            <p role="alert" className={cn(errorClass, 'mt-0 flex items-start gap-1 leading-4')}>
              <CircleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
              <span>{requestError}</span>
            </p>
          ) : (
            <p className={cn(hintClass, 'mt-0')}>
              Pick a colour that stands apart from the other customers.
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
 * Pick a customer's chart colour on a colour wheel (ColorWheel), with the
 * other customers' colours listed to keep clear of. The backend checks the
 * pick (customer_colors.color_problem: too like another customer's) and its 409 sentence is shown under the wheel. Cancel,
 * Escape and the backdrop close it with nothing sent, except while a save is
 * in flight.
 *
 * @param {{
 *   customer: object | null,
 *   customers: object[],
 *   onSubmit: (color: string) => Promise<void>,
 *   onClose: () => void,
 * }} props
 */
export default function CustomerColorDialog({ customer, customers, onSubmit, onClose }) {
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
            onSubmit={onSubmit}
            onCancel={close}
            onPendingChange={setPending}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
