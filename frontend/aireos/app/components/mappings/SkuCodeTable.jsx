'use client';

import { AlertTriangle, CheckCircle2 } from 'lucide-react';

import SelectDropdown from '@/components/ui/SelectDropdown';
import { cn } from '@/lib/utils';
import { PROPOSER } from '@/app/utils/mappingReview';

import ResetButton from './ResetButton';

/**
 * The mapping's product-code table: every product code in the example file,
 * what the retailer calls it, and the master SKU it is. Part of the contract
 * (the sku field's value_map), so it is reviewed and approved with the rest of
 * the mapping. A code that is not a master SKU blocks approval: pick its
 * product here, or add the product to the SKU master first.
 *
 * Shown inside its review step, which carries the heading.
 *
 * @param {{
 *   rows: Array<{ code: string, description: string?, rows: number, sku: string, fromTable: boolean, known: boolean }>,
 *   masterSkus: Array<{ sku: string, product_name: string?, size: string? }>,
 *   masterAvailable: boolean,
 *   onChange: (code: string, sku: string) => void,
 *   codeChanged: (code: string) => boolean,
 *   onResetCode: (code: string) => void,
 *   readOnly?: boolean,
 * }} props
 */
export default function SkuCodeTable({
  rows,
  masterSkus,
  masterAvailable,
  onChange,
  codeChanged,
  onResetCode,
  readOnly = false,
}) {
  return (
    <div>
      {!masterAvailable && (
        <p className="mb-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
          The SKU master could not be read, so codes cannot be checked right now.
        </p>
      )}

      <div className="overflow-x-auto rounded-md border border-lavander">
        <table className="min-w-full text-left text-xs">
          <thead className="bg-cream/60 text-[11px] text-deep-violet-blue/70">
            <tr>
              <th className="px-2 py-1.5 font-medium">Code in the file</th>
              <th className="px-2 py-1.5 font-medium">Description</th>
              <th className="px-2 py-1.5 font-medium">Rows</th>
              <th className="px-2 py-1.5 font-medium">Master SKU</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.code} className={cn('border-t border-lavander', row.known ? 'bg-white' : 'bg-amber-50')}>
                <td className="px-2 py-1.5 font-mono text-deep-violet-blue">{row.code}</td>
                <td className="px-2 py-1.5 text-deep-violet-blue/80">{row.description || '—'}</td>
                <td className="px-2 py-1.5 text-deep-violet-blue/80">{row.rows.toLocaleString()}</td>
                <td className="px-2 py-1.5">
                  <div className="flex items-center gap-2">
                    <SelectDropdown
                      value={row.fromTable ? row.sku : ''}
                      onChange={(sku) => onChange(row.code, sku)}
                      size="sm"
                      searchable={masterSkus.length > 8}
                      searchPlaceholder="Search SKU or product…"
                      placeholder="Choose our product…"
                      ariaLabel={`Master SKU for ${row.code}`}
                      disabled={readOnly}
                      className="sm:w-72"
                      triggerClassName={cn(!row.known && 'border-amber-400 bg-white')}
                      options={[
                        // A code that is already a master SKU can stay as it is.
                        ...(row.known ? [{ value: '', label: `Same code (${row.code})` }] : []),
                        ...masterSkus.map((product) => ({
                          value: product.sku,
                          label: [product.sku, product.product_name, product.size].filter(Boolean).join(' · '),
                        })),
                      ]}
                    />
                    {row.known ? (
                      <CheckCircle2 aria-label="Master SKU" className="size-3.5 shrink-0 text-green-700" />
                    ) : (
                      <AlertTriangle aria-label="Not a master SKU" className="size-3.5 shrink-0 text-amber-700" />
                    )}
                    {codeChanged(row.code) && (
                      <ResetButton
                        compact
                        label={`Reset ${row.code} to the ${PROPOSER}'s proposal`}
                        onClick={() => onResetCode(row.code)}
                        disabled={readOnly}
                      />
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

    </div>
  );
}
