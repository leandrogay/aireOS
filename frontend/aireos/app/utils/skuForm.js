export const emptySkuForm = () => ({
  sku: '',
  sku_range: '',
  product_name: '',
  size: '',
  brand: '',
  uom: '',
  pack_size: '',
  price: '',
});

export function formFromSku(sku) {
  if (!sku) return emptySkuForm();
  return Object.fromEntries(
    Object.keys(emptySkuForm()).map((key) => [key, sku[key] == null ? '' : String(sku[key])]),
  );
}

export function validateSkuForm(form) {
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
  return errors;
}

export function buildSkuPayload(form, includeCode = true) {
  const payload = {
    sku_range: form.sku_range.trim(),
    product_name: form.product_name.trim(),
    size: form.size.trim(),
    brand: form.brand.trim(),
    uom: form.uom.trim(),
    pack_size: Number(form.pack_size),
    price: Number(form.price),
  };
  return includeCode ? { sku: form.sku.trim(), ...payload } : payload;
}
