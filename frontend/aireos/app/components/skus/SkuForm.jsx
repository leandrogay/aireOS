'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';

import CheckboxDropdown from '@/components/promotions/CheckboxDropdown';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { buildSkuPayload, formFromSku, validateSkuForm } from '@/app/utils/skuForm';
import { cn } from '@/lib/utils';

const inputClass =
  'w-full min-w-0 max-w-full rounded-md border border-lavander bg-cream px-2.5 py-1.5 text-sm text-deep-violet-blue placeholder:text-deep-violet-blue/45 focus:border-violet focus:outline-none';
const invalidInputClass = 'border-red-400 focus:border-red-500';
const labelClass = 'mb-1 block text-xs font-medium text-deep-violet-blue';
const errorClass = 'mt-1 text-xs text-red-700';
const hintClass = 'mt-1 text-[11px] text-deep-violet-blue/60';
const optionRowClass =
  'flex min-w-0 cursor-pointer items-center gap-2 overflow-hidden rounded-md px-2 py-1 text-sm text-deep-violet-blue hover:bg-cream';

function RequiredMark() {
  return (
    <span className="text-red-700" aria-hidden="true">
      {' '}
      *
    </span>
  );
}

function FieldError({ message }) {
  if (!message) return null;
  return (
    <p className={errorClass} role="alert">
      {message}
    </p>
  );
}

function FormSection({ step, title, hint, children }) {
  return (
    <section className="grid gap-x-6 gap-y-3 px-4 py-4 md:grid-cols-[11rem_minmax(0,1fr)]">
      <div className="flex items-start gap-2.5">
        <span
          className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-deep-violet-blue font-mono text-[11px] font-medium text-white"
          aria-hidden="true"
        >
          {step}
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-deep-violet-blue">{title}</h3>
          <p className="mt-0.5 text-xs leading-snug text-deep-violet-blue/65">{hint}</p>
        </div>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function TextField({ label, value, error, onChange, readOnly = false, ...inputProps }) {
  return (
    <label>
      <span className={labelClass}>
        {label}
        <RequiredMark />
      </span>
      <input
        required
        type="text"
        value={value}
        readOnly={readOnly}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={Boolean(error)}
        className={cn(
          inputClass,
          readOnly && 'cursor-not-allowed bg-muted text-muted-foreground',
          error && invalidInputClass,
        )}
        {...inputProps}
      />
      <FieldError message={error} />
    </label>
  );
}

/**
 * Single-select version of the Promotions dropdown. Existing catalog values
 * remain one click away, while a searched value can still be added for a new
 * product line instead of turning the options list into a closed vocabulary.
 */
function OptionField({
  name,
  label,
  value,
  options = [],
  error,
  onChange,
  numeric = false,
}) {
  const allOptions = [...new Set(options.map(String).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right, undefined, { numeric: true }),
  );

  return (
    <fieldset>
      <legend className={labelClass}>
        {label}
        <RequiredMark />
      </legend>
      <CheckboxDropdown
        summary={String(value || '')}
        placeholder={`Select ${label.toLowerCase()}`}
        invalid={Boolean(error)}
        searchable
        searchPlaceholder={`Search or enter ${label.toLowerCase()}...`}
      >
        {(query, close) => {
          const candidate = query.trim();
          const needle = candidate.toLowerCase();
          const visibleOptions = needle
            ? allOptions.filter((option) => option.toLowerCase().includes(needle))
            : allOptions;
          const exactMatch = allOptions.some(
            (option) => option.toLowerCase() === needle,
          );
          const validCandidate =
            candidate && !exactMatch && (!numeric || /^\d+$/.test(candidate));

          return (
            <>
              {visibleOptions.map((option) => (
                <label key={option} className={optionRowClass}>
                  <input
                    type="radio"
                    name={name}
                    value={option}
                    checked={String(value) === option}
                    onChange={() => {
                      onChange(option);
                      close();
                    }}
                    className="size-3.5 accent-deep-violet-blue"
                  />
                  <span className="min-w-0 truncate">{option}</span>
                </label>
              ))}
              {validCandidate && (
                <button
                  type="button"
                  onClick={() => {
                    onChange(candidate);
                    close();
                  }}
                  className={`${optionRowClass} w-full border-t border-lavander text-left font-medium`}
                >
                  Use &ldquo;{candidate}&rdquo;
                </button>
              )}
              {!visibleOptions.length && !validCandidate && (
                <p className="px-2 py-1 text-xs text-deep-violet-blue/60">
                  {numeric ? 'Enter a whole number.' : 'No matching options.'}
                </p>
              )}
            </>
          );
        }}
      </CheckboxDropdown>
      <p className={hintClass}>Choose an existing value or search to add a new one.</p>
      <FieldError message={error} />
    </fieldset>
  );
}

export default function SkuForm({ open, sku, options = {}, onSave, onClose }) {
  const isEdit = Boolean(sku);
  const [form, setForm] = useState(() => formFromSku(sku));
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState('');
  const [saving, setSaving] = useState(false);
  const errorCount = Object.values(errors).filter(Boolean).length;

  const change = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const submit = async (event) => {
    event.preventDefault();
    const nextErrors = validateSkuForm(form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    setSaving(true);
    setSubmitError('');
    try {
      await onSave(buildSkuPayload(form, !isEdit));
    } catch (error) {
      setSubmitError(error.message || 'Unable to save SKU.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !saving) onClose(); }}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto bg-transparent p-0 ring-0 sm:max-w-[min(64rem,calc(100%-2rem))]"
      >
        <form
          noValidate
          onSubmit={submit}
          className="relative overflow-hidden rounded-lg border border-lavander bg-white shadow-sm"
        >
          {saving && (
            <div
              role="status"
              aria-live="polite"
              className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-lg bg-white/70 text-deep-violet-blue/70 backdrop-blur-[1px]"
            >
              <Loader2 className="h-6 w-6 animate-spin" />
              <p className="text-sm">{isEdit ? 'Saving changes...' : 'Creating SKU...'}</p>
            </div>
          )}

          <div className="flex flex-wrap items-end justify-between gap-2 border-b border-lavander py-3 pl-4 pr-12">
            <div>
              <DialogTitle className="font-serif text-xl text-deep-violet-blue">
                {isEdit ? `Edit ${sku.sku}` : 'Create SKU'}
              </DialogTitle>
              <DialogDescription className="mt-0.5 text-xs text-deep-violet-blue/65">
                Fields marked <span className="text-red-700">*</span> are required.
              </DialogDescription>
            </div>
            {isEdit && (
              <span className="rounded-full border border-violet bg-lavander px-2.5 py-0.5 text-[11px] font-medium text-deep-violet-blue">
                SKU code cannot be changed
              </span>
            )}
          </div>

          <fieldset
            disabled={saving}
            aria-busy={saving}
            className="min-w-0 divide-y divide-lavander"
          >
            <FormSection
              step={1}
              title="Product identity"
              hint="Use the retailer's SKU code and the customer-facing product name."
            >
              <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 [&>*]:min-w-0">
                <TextField
                  label="SKU code"
                  value={form.sku}
                  error={errors.sku}
                  readOnly={isEdit}
                  onChange={(value) => change('sku', value)}
                  placeholder="e.g. 13255043"
                />
                <TextField
                  label="Product name"
                  value={form.product_name}
                  error={errors.product_name}
                  onChange={(value) => change('product_name', value)}
                  placeholder="e.g. Aire Adult Pants XL"
                />
              </div>
            </FormSection>

            <FormSection
              step={2}
              title="Classification"
              hint="Reuse catalog values where suitable, or enter a new value in the dropdown search."
            >
              <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3 [&>*]:min-w-0">
                <OptionField
                  name="sku-range"
                  label="SKU range"
                  value={form.sku_range}
                  options={options.sku_ranges}
                  error={errors.sku_range}
                  onChange={(value) => change('sku_range', value)}
                />
                <OptionField
                  name="brand"
                  label="Brand"
                  value={form.brand}
                  options={options.brands}
                  error={errors.brand}
                  onChange={(value) => change('brand', value)}
                />
                <OptionField
                  name="size"
                  label="Size"
                  value={form.size}
                  options={options.sizes}
                  error={errors.size}
                  onChange={(value) => change('size', value)}
                />
              </div>
            </FormSection>

            <FormSection
              step={3}
              title="Packaging & price"
              hint="Define how the product is sold and its current catalog price."
            >
              <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3 [&>*]:min-w-0">
                <OptionField
                  name="uom"
                  label="Unit of measure"
                  value={form.uom}
                  options={options.uoms}
                  error={errors.uom}
                  onChange={(value) => change('uom', value)}
                />
                <OptionField
                  name="pack-size"
                  label="Pack size"
                  value={form.pack_size}
                  options={options.pack_sizes}
                  error={errors.pack_size}
                  onChange={(value) => change('pack_size', value)}
                  numeric
                />
                <label>
                  <span className={labelClass}>
                    Price (SGD)
                    <RequiredMark />
                  </span>
                  <input
                    required
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.price}
                    onChange={(event) => change('price', event.target.value)}
                    aria-invalid={Boolean(errors.price)}
                    className={cn(inputClass, errors.price && invalidInputClass)}
                    placeholder="0.00"
                  />
                  <FieldError message={errors.price} />
                </label>
              </div>
            </FormSection>
          </fieldset>

          {submitError && (
            <p className="mx-4 mb-3 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700" role="alert">
              {submitError}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-b-lg border-t border-lavander bg-cream/40 px-4 py-3">
            <p className="text-xs text-red-700" role="status">
              {errorCount > 0 &&
                `Fix ${errorCount} highlighted ${errorCount === 1 ? 'field' : 'fields'} above.`}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="rounded-md border border-deep-violet-blue/30 bg-white px-4 py-1.5 text-sm font-medium text-deep-violet-blue transition hover:bg-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-md border border-deep-violet-blue bg-deep-violet-blue px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? 'Saving...' : isEdit ? 'Save changes' : 'Create SKU'}
              </button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
