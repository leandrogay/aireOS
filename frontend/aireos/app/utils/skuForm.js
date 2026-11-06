import { singaporeToday } from '@/lib/singaporeTime';

function todayString() {
  const today = singaporeToday();
  return [today.getFullYear(), String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0')].join('-');
}

export const emptySkuForm = () => ({
  sku: '',
  sku_range: '',
  product_name: '',
  size: '',
  brand: '',
  uom: '',
  pack_size: '',
  price: '',
  price_effective_from: todayString(),
  price_effective_to: '',
});

export function formFromSku(sku) {
  if (!sku) return emptySkuForm();
  const form = emptySkuForm();
  for (const key of ['sku', 'sku_range', 'product_name', 'size', 'brand', 'uom', 'pack_size', 'price']) {
    form[key] = sku[key] == null ? '' : String(sku[key]);
  }
  return form;
}

export function validateSkuForm(form, priceChanged = true) {
  const errors = {};
  for (const field of ['sku', 'sku_range', 'product_name', 'size', 'brand', 'uom']) {
    if (!form[field]?.trim()) errors[field] = 'Required';
  }
  if (!Number.isInteger(Number(form.pack_size)) || Number(form.pack_size) <= 0) {
    errors.pack_size = 'Enter a whole number greater than 0';
  }
  if (form.price === '' || Number.isNaN(Number(form.price)) || Number(form.price) < 0) {
    errors.price = 'Enter a valid price of 0 or more';
  }
  if (priceChanged) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.price_effective_from || '')) {
      errors.price_effective_from = 'Choose when this price starts';
    }
    if (form.price_effective_to &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(form.price_effective_to) ||
         form.price_effective_to < form.price_effective_from)) {
      errors.price_effective_to = 'End date must be on or after the start date';
    }
  }
  return errors;
}

export function buildSkuPayload(form, includeCode = true, priceChanged = true) {
  const payload = {
    sku_range: form.sku_range.trim(),
    product_name: form.product_name.trim(),
    size: form.size.trim(),
    brand: form.brand.trim(),
    uom: form.uom.trim(),
    pack_size: Number(form.pack_size),
    price: Number(form.price),
    ...(priceChanged ? {
      price_effective_from: form.price_effective_from,
      price_effective_to: form.price_effective_to || null,
    } : {}),
  };
  return includeCode ? { sku: form.sku.trim(), ...payload } : { ...payload, price_changed: priceChanged };
}
