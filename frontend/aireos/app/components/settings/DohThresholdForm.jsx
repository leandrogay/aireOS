'use client';

import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  cardClass,
  errorClass,
  hintClass,
  inputClass,
  invalidInputClass,
  labelClass,
} from '@/components/inventory/formStyles';
import { saveDohThresholds } from '@/app/services/settingsApi';
import {
  DOH_THRESHOLD_FIELDS,
  buildDohThresholdPayload,
  formFromDohSettings,
  validateDohThresholdForm,
} from '@/app/utils/dohSettingsForm';
import { cn } from '@/lib/utils';

/**
 * Edits one customer's Min / Target / Max DOH. Errors are derived from the
 * form on every render and shown for a field once it has been left (or after
 * a submit attempt), so an invalid value is flagged before anything is sent.
 * The parent keys this by customer, so switching customer starts fresh.
 *
 * @param {object} props
 * @param {object} props.settings the customer's row from getDohSettings
 * @param {(result: { changed: boolean, settings: object }) => void} props.onSaved
 * @param {() => void} props.onCancel
 */
export default function DohThresholdForm({ settings, onSaved, onCancel }) {
  const [form, setForm] = useState(() => formFromDohSettings(settings));
  const [touched, setTouched] = useState({});
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const sectionRef = useRef(null);
  const firstInputRef = useRef(null);

  // The form opens below the table, so bring it into view and put the cursor
  // in the first field.
  useEffect(() => {
    sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    firstInputRef.current?.focus({ preventScroll: true });
  }, []);

  const errors = validateDohThresholdForm(form);
  const shownError = (name) => (submitAttempted || touched[name] ? errors[name] : undefined);

  function handleChange(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
    setSubmitError('');
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitAttempted(true);
    setSubmitError('');
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    try {
      const result = await saveDohThresholds(settings.customer_id, buildDohThresholdPayload(form));
      onSaved(result);
    } catch (err) {
      setSubmitError(err.message);
      setSubmitting(false);
    }
  }

  return (
    <section ref={sectionRef} className={cardClass} aria-labelledby="doh-threshold-form-title">
      <h2 id="doh-threshold-form-title" className="mb-2 text-sm font-medium text-deep-violet-blue">
        Configure thresholds — {settings.customer_name}
      </h2>

      <form onSubmit={handleSubmit} noValidate className="grid max-w-3xl gap-3">
        <div className="grid gap-3 sm:grid-cols-3">
          {DOH_THRESHOLD_FIELDS.map(({ name, label }, index) => {
            const error = shownError(name);
            const inputId = `doh-${name}`;
            return (
              <div key={name}>
                <label htmlFor={inputId} className={labelClass}>
                  {label} (days)<span className="text-red-700"> *</span>
                </label>
                <input
                  id={inputId}
                  ref={index === 0 ? firstInputRef : undefined}
                  type="text"
                  inputMode="numeric"
                  value={form[name]}
                  onChange={(e) => handleChange(name, e.target.value)}
                  onBlur={() => setTouched((current) => ({ ...current, [name]: true }))}
                  aria-invalid={Boolean(error)}
                  aria-describedby={`${inputId}-help`}
                  disabled={submitting}
                  className={cn(inputClass, error && invalidInputClass)}
                />
                {error ? (
                  <p id={`${inputId}-help`} className={errorClass} role="alert">
                    {error}
                  </p>
                ) : (
                  <p id={`${inputId}-help`} className={hintClass}>
                    Whole days, 0 or more.
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <p className={cn(hintClass, 'mt-0')}>Min DOH ≤ Target DOH ≤ Max DOH.</p>

        {submitError && (
          <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
            {submitError}
          </p>
        )}

        <div className="flex gap-2">
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Saving…' : 'Save thresholds'}
          </Button>
          <Button type="button" variant="outline" disabled={submitting} onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </section>
  );
}
