'use client';

import { useEffect, useRef, useState } from 'react';
import { CircleAlert, Loader2, RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { errorClass, inputClass, invalidInputClass, labelClass } from '@/components/inventory/formStyles';
import { saveDohThresholds } from '@/app/services/settingsApi';
import {
  DEFAULT_DOH_THRESHOLD_FORM,
  DOH_THRESHOLD_FIELDS,
  GLOBAL_DEFAULT_DOH,
  buildDohThresholdPayload,
  formFromDohSettings,
  isSameDohThresholdForm,
  validateDohThresholdForm,
} from '@/app/utils/dohSettingsForm';
import { retailerLabel } from '@/app/utils/retailerLabel';
import { cn } from '@/lib/utils';

// The promotions form's buttons (deep-violet primary, outlined secondary),
// applied to the shared Button primitive.
const primaryButtonClass =
  'h-auto border-deep-violet-blue bg-deep-violet-blue px-4 py-1.5 text-white hover:bg-deep-violet-blue/90';
const secondaryButtonClass =
  'h-auto border-deep-violet-blue/30 bg-white px-4 py-1.5 text-deep-violet-blue hover:bg-cream';

/**
 * A group of fields read top to bottom: title, then a full-width hint, then
 * the fields. The promotions form puts title and hint in a left column
 * because it has four sections to scan; with a single short section that
 * column only squeezed the text, so this form stacks instead.
 *
 * @param {{ title: string, hint: string, children: import('react').ReactNode }} props
 */
function FormSection({ title, hint, children }) {
  return (
    <section className="px-4 py-4">
      <h3 className="text-sm font-semibold text-deep-violet-blue">{title}</h3>
      <p className="mt-0.5 text-xs leading-snug text-deep-violet-blue/65">{hint}</p>
      <div className="mt-3 min-w-0">{children}</div>
    </section>
  );
}

/**
 * Edits one customer's Min / Target / Max DOH. Errors are derived from the
 * form on every render and shown for a field once it has been left (or after
 * a submit attempt), so an invalid value is flagged before anything is sent.
 *
 * "Restore defaults" follows the usual settings-form pattern: it only fills the
 * fields with the global default (with an Undo), and nothing changes until
 * Save, which is the confirmation; Cancel discards it. Saving the default
 * values puts the customer back on the Global Default (the backend reports a
 * customer whose values equal the defaults as on it).
 *
 * The parent keys this by customer, so opening another customer starts fresh
 * (and replays the edit flash).
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
  const [requestError, setRequestError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // The values the fields held before "Restore defaults", for Undo.
  const [valuesBeforeRestore, setValuesBeforeRestore] = useState(null);
  const formRef = useRef(null);
  const firstInputRef = useRef(null);

  // The form opens below the table, so bring it into view and put the cursor
  // in the first field.
  useEffect(() => {
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    firstInputRef.current?.focus({ preventScroll: true });
  }, []);

  const errors = validateDohThresholdForm(form);
  const shownError = (name) => (submitAttempted || touched[name] ? errors[name] : undefined);
  const shownErrorCount = DOH_THRESHOLD_FIELDS.filter(({ name }) => shownError(name)).length;
  const showsDefaults = isSameDohThresholdForm(form, DEFAULT_DOH_THRESHOLD_FORM);
  // The notice stays while the restored values are untouched; editing a field
  // makes it an ordinary edit again.
  const restoredPending = valuesBeforeRestore !== null && showsDefaults;

  function handleChange(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
    setRequestError('');
  }

  function handleRestoreDefaults() {
    setValuesBeforeRestore(form);
    setForm(DEFAULT_DOH_THRESHOLD_FORM);
    setRequestError('');
  }

  function handleUndoRestore() {
    setForm(valuesBeforeRestore);
    setValuesBeforeRestore(null);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitAttempted(true);
    setRequestError('');
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    try {
      onSaved(await saveDohThresholds(settings.customer_id, buildDohThresholdPayload(form)));
    } catch (err) {
      setRequestError(err.message);
      setSubmitting(false);
    }
  }

  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={handleSubmit}
      aria-labelledby="doh-threshold-form-title"
      className="animate-edit-flash relative rounded-lg border border-lavander bg-white shadow-sm"
    >
      {/* Sits above the disabled fieldset while the request is in flight. */}
      {submitting && (
        <div
          role="status"
          aria-live="polite"
          className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-lg bg-white/70 text-deep-violet-blue/70 backdrop-blur-[1px]"
        >
          <Loader2 className="h-6 w-6 animate-spin" />
          <p className="text-sm">Saving thresholds…</p>
        </div>
      )}

      {/* ==== Header ==== */}
      <div className="flex flex-wrap items-end justify-between gap-2 border-b border-lavander px-4 py-3">
        <div>
          <h2 id="doh-threshold-form-title" className="font-serif text-xl text-deep-violet-blue">
            Edit DOH thresholds — {retailerLabel(settings.customer_name)}
          </h2>
          <p className="mt-0.5 text-xs text-deep-violet-blue/65">
            Fields marked <span className="text-red-700">*</span> are required.
          </p>
        </div>
        <span className="rounded-full border border-violet bg-lavander px-2.5 py-0.5 text-[11px] font-medium text-deep-violet-blue">
          {settings.is_global_default ? 'Global Default' : 'Custom thresholds'}
        </span>
      </div>

      {/* A disabled fieldset locks every control inside it while saving. */}
      <fieldset disabled={submitting} aria-busy={submitting} className="min-w-0">
        <FormSection
          title="Thresholds"
          hint={`Min DOH ≤ Target DOH ≤ Max DOH. Global default: target ${GLOBAL_DEFAULT_DOH.target}, min ${GLOBAL_DEFAULT_DOH.min}, max ${GLOBAL_DEFAULT_DOH.max}.`}
        >
          {/* Min, Target and Max stay in one row: they are one range, read left to
              right. 11rem wraps the longest error message onto at most two lines,
              and items-start keeps the inputs level when one message runs longer. */}
          <div className="grid grid-cols-1 items-start gap-x-5 gap-y-4 sm:grid-cols-[repeat(3,11rem)] [&>*]:min-w-0">
            {DOH_THRESHOLD_FIELDS.map(({ name, label }, index) => {
              const error = shownError(name);
              const inputId = `doh-${name}`;
              return (
                <div key={name}>
                  <label htmlFor={inputId} className={labelClass}>
                    {label}
                    <span className="text-red-700" aria-hidden="true">
                      {' '}
                      *
                    </span>
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
                    aria-describedby={error ? `${inputId}-error` : undefined}
                    required
                    className={cn(inputClass, error && invalidInputClass)}
                  />
                  {/* One line is always reserved, so a short error appears without
                      pushing the rest of the form down. */}
                  <div className="mt-1 min-h-4">
                    {error && (
                      <p
                        id={`${inputId}-error`}
                        role="alert"
                        className={cn(errorClass, 'mt-0 flex items-start gap-1 leading-4')}
                      >
                        <CircleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
                        <span>{error}</span>
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {restoredPending && (
            <div
              role="status"
              className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-violet bg-lavander/60 px-3 py-2 text-xs text-deep-violet-blue"
            >
              <span>Global default values filled in. Save thresholds to apply them.</span>
              <button
                type="button"
                onClick={handleUndoRestore}
                className="font-medium underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet"
              >
                Undo
              </button>
            </div>
          )}
        </FormSection>
      </fieldset>

      {/* ==== Actions ==== */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-b-lg border-t border-lavander bg-cream/40 px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          {/* Secondary action on the left, away from Save. */}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={submitting || showsDefaults}
            onClick={handleRestoreDefaults}
            title={showsDefaults ? 'The fields already hold the global default' : undefined}
            className="text-deep-violet-blue hover:bg-lavander"
          >
            <RotateCcw aria-hidden="true" />
            Restore defaults
          </Button>
          <p className="text-xs text-red-700" role="status">
            {requestError ||
              (shownErrorCount > 0 &&
                `Fix ${shownErrorCount} highlighted ${shownErrorCount === 1 ? 'field' : 'fields'} above.`)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={submitting}
            onClick={onCancel}
            className={secondaryButtonClass}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={submitting} className={primaryButtonClass}>
            {submitting ? 'Saving…' : 'Save thresholds'}
          </Button>
        </div>
      </div>
    </form>
  );
}
