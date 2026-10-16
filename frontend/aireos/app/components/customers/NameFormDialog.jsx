'use client';

import { useState } from 'react';
import { CircleAlert, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import {
  errorClass,
  hintClass,
  inputClass,
  invalidInputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '@/components/inventory/formStyles';
import { normaliseName, validateName } from '@/app/utils/customerForm';
import { cn } from '@/lib/utils';

/**
 * The one-field form inside the dialog. Mounted fresh each time the dialog
 * opens (the parent keys it), so an edit always starts from the saved name.
 *
 * @param {{
 *   title: string,
 *   fieldLabel: string,
 *   kind: 'customer' | 'retailer',
 *   initialName: string,
 *   takenNames: Set<string>,
 *   submitLabel: string,
 *   pendingLabel: string,
 *   onSubmit: (name: string) => Promise<void>,
 *   onCancel: () => void,
 *   onPendingChange: (pending: boolean) => void,
 * }} props
 */
function NameForm({
  title,
  fieldLabel,
  kind,
  initialName,
  takenNames,
  submitLabel,
  pendingLabel,
  onSubmit,
  onCancel,
  onPendingChange,
}) {
  const [name, setName] = useState(initialName);
  const [touched, setTouched] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [requestError, setRequestError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const error = validateName(name, takenNames, kind);
  const shownError = submitAttempted || touched ? error : '';
  const slug = normaliseName(name);
  // Say how the name will be stored whenever that differs from what was typed.
  const showSlug = !error && slug !== name.trim();

  function setPending(pending) {
    setSubmitting(pending);
    onPendingChange(pending);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitAttempted(true);
    setRequestError('');
    if (error) return;

    // Saving an edit with the same name changes nothing, so it is a Cancel.
    if (initialName && slug === normaliseName(initialName)) {
      onCancel();
      return;
    }

    setPending(true);
    try {
      await onSubmit(name.trim());
      // The parent has closed the dialog; clear its lock for the next open.
      onPendingChange(false);
    } catch (err) {
      // e.g. a 409 for a name taken since the list loaded: keep the dialog
      // open with the server's sentence under the field.
      setRequestError(err.message);
      setPending(false);
    }
  }

  const message = shownError || requestError;

  return (
    <form
      noValidate
      onSubmit={handleSubmit}
      className="relative rounded-lg border border-lavander bg-white shadow-sm"
    >
      {/* Sits above the disabled fieldset while the request is in flight. */}
      {submitting && (
        <div
          role="status"
          aria-live="polite"
          className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-lg bg-white/70 text-deep-violet-blue/70 backdrop-blur-[1px]"
        >
          <Loader2 className="h-6 w-6 animate-spin" />
          <p className="text-sm">{pendingLabel}</p>
        </div>
      )}

      {/* ==== Header ==== */}
      <div className="border-b border-lavander py-3 pl-4 pr-12">
        <h2 className="font-serif text-xl text-deep-violet-blue">{title}</h2>
        <p className="mt-0.5 text-xs text-deep-violet-blue/65">
          Fields marked <span className="text-red-700">*</span> are required.
        </p>
      </div>

      <fieldset disabled={submitting} aria-busy={submitting} className="min-w-0 px-4 py-4">
        <label htmlFor="name-form-field" className={labelClass}>
          {fieldLabel}
          <span className="text-red-700" aria-hidden="true">
            {' '}
            *
          </span>
        </label>
        <input
          id="name-form-field"
          type="text"
          autoFocus
          autoComplete="off"
          maxLength={255}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setRequestError('');
          }}
          onBlur={() => setTouched(true)}
          aria-invalid={Boolean(message)}
          aria-describedby={message ? 'name-form-error' : undefined}
          required
          className={cn(inputClass, message && invalidInputClass)}
        />
        {/* One line is always reserved, so a message appears without moving the buttons. */}
        <div className="mt-1 min-h-4">
          {message ? (
            <p id="name-form-error" role="alert" className={cn(errorClass, 'mt-0 flex items-start gap-1 leading-4')}>
              <CircleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
              <span>{message}</span>
            </p>
          ) : (
            showSlug && <p className={cn(hintClass, 'mt-0')}>Saved as {slug}</p>
          )}
        </div>
      </fieldset>

      {/* ==== Actions ==== */}
      <div className="flex items-center justify-end gap-2 rounded-b-lg border-t border-lavander bg-cream/40 px-4 py-3">
        <Button type="button" variant="outline" disabled={submitting} onClick={onCancel} className={secondaryButtonClass}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting} className={primaryButtonClass}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

/**
 * Add or rename a customer or a retailer: one name field with Save and
 * Cancel, in the promotions form's modal shell. The name is checked as it is
 * typed (empty, symbols, a name already on the page); the backend checks it
 * again and its 409 sentence is shown under the field. Cancel, Escape and the
 * backdrop all close it with nothing sent, except while a save is in flight.
 *
 * @param {{
 *   open: boolean,
 *   formKey: string,
 *   title: string,
 *   fieldLabel: string,
 *   kind: 'customer' | 'retailer',
 *   initialName?: string,
 *   takenNames: Set<string>,
 *   submitLabel: string,
 *   pendingLabel: string,
 *   onSubmit: (name: string) => Promise<void>,
 *   onClose: () => void,
 * }} props
 */
export default function NameFormDialog({ open, formKey, initialName = '', onClose, ...formProps }) {
  const [pending, setPending] = useState(false);

  function close() {
    if (pending) return;
    onClose();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent
        aria-label={formProps.title}
        className="bg-transparent p-0 ring-0 sm:max-w-md"
      >
        {open && (
          <NameForm
            key={formKey}
            initialName={initialName}
            onCancel={close}
            onPendingChange={setPending}
            {...formProps}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
