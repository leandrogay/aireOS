'use client';

import { AlertTriangle, CheckCircle2 } from 'lucide-react';

/**
 * The mapping's product-code table: every product code in the example file,
 * what the retailer calls it, and the master SKU it is. Part of the contract
 * (the sku field's value_map), so it is reviewed and approved with the rest of
 * the mapping. A code that is not a master SKU blocks approval: pick its
 * product here, or add the product to the SKU master first.
 *
 * @param {{
 *   rows: Array<{ code: string, description: string?, rows: number, sku: string, fromTable: boolean, known: boolean }>,
 *   masterSkus: Array<{ sku: string, product_name: string?, size: string? }>,
 *   masterAvailable: boolean,
 *   onChange: (code: string, sku: string) => void,
 *   readOnly?: boolean,
 * }} props
 */
export default function SkuCodeTable({ rows, masterSkus, masterAvailable, onChange, readOnly = false }) {
  if (!rows.length) return null;
  const unknown = rows.filter((row) => !row.known).length;

  return (
    <section className="rounded-lg border border-lavander bg-white p-6 shadow-sm">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div>
          <h3 className="font-serif text-lg text-deep-violet-blue">Product codes</h3>
          <p className="text-xs text-deep-violet-blue/70">
            Each product code in the file and the master SKU it is. A code left as it is must
            itself be a master SKU.
          </p>
        </div>
        <p className={`text-sm font-medium ${unknown ? 'text-red-700' : 'text-deep-violet-blue'}`}>
          {unknown ? `${unknown} not a master SKU` : `All ${rows.length} are master SKUs`}
        </p>
      </div>

      {!masterAvailable && (
        <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
          The SKU master could not be read, so the codes cannot be checked right now.
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-lavander">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-lavander text-deep-violet-blue">
            <tr>
              <th className="px-3 py-2 font-medium">Code in the file</th>
              <th className="px-3 py-2 font-medium">Their description</th>
              <th className="px-3 py-2 font-medium">Rows</th>
              <th className="px-3 py-2 font-medium">Master SKU</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.code} className={`border-t border-lavander ${row.known ? 'bg-white' : 'bg-red-50/60'}`}>
                <td className="px-3 py-2 font-mono text-xs text-deep-violet-blue">{row.code}</td>
                <td className="px-3 py-2 text-xs text-deep-violet-blue/80">{row.description || '—'}</td>
                <td className="px-3 py-2 text-xs text-deep-violet-blue/80">{row.rows.toLocaleString()}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    {row.known ? (
                      <CheckCircle2 aria-hidden="true" className="size-3.5 shrink-0 text-green-700" />
                    ) : (
                      <AlertTriangle aria-hidden="true" className="size-3.5 shrink-0 text-red-700" />
                    )}
                    <select
                      value={row.fromTable ? row.sku : ''}
                      disabled={readOnly}
                      onChange={(event) => onChange(row.code, event.target.value)}
                      aria-label={`Master SKU for ${row.code}`}
                      className="w-full rounded-md border border-violet bg-white px-2 py-1.5 text-xs text-deep-violet-blue focus:border-deep-violet-blue focus:outline-none focus-visible:ring-2 focus-visible:ring-deep-violet-blue disabled:opacity-60 sm:w-72"
                    >
                      <option value="">
                        {row.known ? `As it is (${row.code})` : 'Not a master SKU — choose one…'}
                      </option>
                      {masterSkus.map((product) => (
                        <option key={product.sku} value={product.sku}>
                          {product.sku}
                          {product.product_name ? ` · ${product.product_name}` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {unknown > 0 && (
        <p className="mt-2 text-xs text-red-700">
          A product that is not in the SKU master yet has to be added there first; this mapping can
          then be approved.
        </p>
      )}
    </section>
  );
}
