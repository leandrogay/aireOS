'use client';

import { useId, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { buildSkuPayload, formFromSku, validateSkuForm } from '@/app/utils/skuForm';

const FIELDS = [
  { key: 'sku_range', label: 'SKU range', optionKey: 'sku_ranges' },
  { key: 'product_name', label: 'Product name' },
  { key: 'size', label: 'Size', optionKey: 'sizes' },
  { key: 'brand', label: 'Brand', optionKey: 'brands' },
  { key: 'uom', label: 'Unit of measure', optionKey: 'uoms' },
];

function TextField({ field, value, error, options, onChange }) {
  const listId = useId();
  return (
    <label className="grid gap-1 text-sm font-medium text-deep-violet-blue">
      {field.label} <span className="sr-only">required</span>
      <input
        required
        type="text"
        list={options?.length ? listId : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={Boolean(error)}
        className="h-9 rounded-lg border border-lavander bg-white px-3 font-normal outline-none focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-red-500"
      />
      {options?.length > 0 && <datalist id={listId}>{options.map((item) => <option key={item} value={item} />)}</datalist>}
      {error && <span className="text-xs font-normal text-red-700">{error}</span>}
    </label>
  );
}

export default function SkuForm({ open, sku, options, onSave, onClose }) {
  const isEdit = Boolean(sku);
  const [form, setForm] = useState(() => formFromSku(sku));
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState('');
  const [saving, setSaving] = useState(false);

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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${sku.sku}` : 'Create SKU'}</DialogTitle>
          <DialogDescription>
            {isEdit ? 'The SKU code is fixed to preserve references in sales, inventory and promotions.' : 'Add a product to the active SKU catalogue.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1 text-sm font-medium text-deep-violet-blue sm:col-span-2">
            SKU code <span className="sr-only">required</span>
            <input
              required
              readOnly={isEdit}
              value={form.sku}
              onChange={(event) => change('sku', event.target.value)}
              aria-invalid={Boolean(errors.sku)}
              className="h-9 rounded-lg border border-lavander bg-white px-3 font-normal outline-none read-only:bg-muted read-only:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-red-500"
            />
            {errors.sku && <span className="text-xs font-normal text-red-700">{errors.sku}</span>}
          </label>

          {FIELDS.map((field) => (
            <TextField
              key={field.key}
              field={field}
              value={form[field.key]}
              error={errors[field.key]}
              options={field.optionKey ? options[field.optionKey] : []}
              onChange={(value) => change(field.key, value)}
            />
          ))}

          <label className="grid gap-1 text-sm font-medium text-deep-violet-blue">
            Pack size <span className="sr-only">required</span>
            <input
              required
              type="number"
              min="1"
              step="1"
              list="sku-pack-sizes"
              value={form.pack_size}
              onChange={(event) => change('pack_size', event.target.value)}
              aria-invalid={Boolean(errors.pack_size)}
              className="h-9 rounded-lg border border-lavander bg-white px-3 font-normal outline-none focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-red-500"
            />
            <datalist id="sku-pack-sizes">{(options.pack_sizes || []).map((item) => <option key={item} value={item} />)}</datalist>
            {errors.pack_size && <span className="text-xs font-normal text-red-700">{errors.pack_size}</span>}
          </label>

          <label className="grid gap-1 text-sm font-medium text-deep-violet-blue">
            Price (SGD) <span className="sr-only">required</span>
            <input
              required
              type="number"
              min="0"
              step="0.01"
              value={form.price}
              onChange={(event) => change('price', event.target.value)}
              aria-invalid={Boolean(errors.price)}
              className="h-9 rounded-lg border border-lavander bg-white px-3 font-normal outline-none focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-red-500"
            />
            {errors.price && <span className="text-xs font-normal text-red-700">{errors.price}</span>}
          </label>

          {submitError && <p className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700 sm:col-span-2">{submitError}</p>}
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create SKU'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
