// The product-code table of a mapping contract: the sku field's value_map
// transform, giving each retailer product code in the file the master SKU it
// is (backend mapping_contract, mapping_checks.sku_codes). A code with no
// entry is used as it is, which is right only when it is itself a master SKU
// (FairPrice article numbers). Pure helpers for the review screen.

/** The code -> master SKU entries of a field's transforms. */
export function codeTableOf(transforms) {
  const table = (Array.isArray(transforms) ? transforms : []).find((t) => t?.type === 'value_map');
  return table?.values || {};
}

/**
 * The field's transforms with one code's entry set, or removed when `sku` is
 * empty. The value_map is created if there is none, before any other
 * transform, so the code is translated before anything else reads it.
 */
export function withCodeTable(transforms, code, sku) {
  const list = Array.isArray(transforms) ? transforms : [];
  const index = list.findIndex((t) => t?.type === 'value_map');
  const values = { ...(index >= 0 ? list[index].values : {}) };
  if (sku) values[code] = sku;
  else delete values[code];

  if (index >= 0) {
    if (!Object.keys(values).length && !list[index].default) {
      return list.filter((_, i) => i !== index);
    }
    return list.map((t, i) => (i === index ? { ...t, values } : t));
  }
  return Object.keys(values).length ? [{ type: 'value_map', values }, ...list] : list;
}

/**
 * One row per product code in the example file, with the master SKU it reads
 * as now and whether that is a master SKU at all.
 *
 * @returns {{ code: string, description: string?, rows: number, sku: string, fromTable: boolean, known: boolean }[]}
 */
export function codeRows(skuCodes, transforms, masterSkus) {
  const table = codeTableOf(transforms);
  const master = new Set((masterSkus || []).map((product) => String(product.sku)));
  return (skuCodes || []).map((item) => {
    const fromTable = Object.hasOwn(table, item.code);
    const sku = fromTable ? table[item.code] : item.code;
    return { code: item.code, description: item.description, rows: item.rows, sku, fromTable, known: master.has(sku) };
  });
}

/** The codes that do not read as a master SKU. */
export function unknownCodes(rows) {
  return rows.filter((row) => !row.known).map((row) => row.code);
}
