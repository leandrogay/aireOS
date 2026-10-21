'use client';

import { Button } from '@/components/ui/button';
import StatusPill from '@/components/ui/StatusPill';
import TableGrid from '@/components/ui/TableGrid';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatDateTime } from '@/lib/formatDate';

import { SKU_HISTORY_COLUMNS } from './columns';

const money = new Intl.NumberFormat('en-SG', { style: 'currency', currency: 'SGD' });
const ACTION_TONES = { created: 'success', updated: 'info', archived: 'muted' };

export default function SkuDetails({ open, sku, loading, error, onEdit, onClose }) {
  const fields = sku ? [
    ['SKU range', sku.sku_range], ['Product name', sku.product_name], ['Size', sku.size],
    ['Brand', sku.brand], ['Unit of measure', sku.uom], ['Pack size', sku.pack_size],
    ['Price', money.format(Number(sku.price))],
  ] : [];

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{sku?.sku || 'SKU details'}</DialogTitle>
          <DialogDescription>Current master data and its recorded update history.</DialogDescription>
        </DialogHeader>
        {loading && <p className="py-10 text-center text-muted-foreground">Loading details…</p>}
        {error && <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {!loading && !error && sku && (
          <>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg border border-border p-4">
              {fields.map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="mt-0.5 font-medium">{value}</dd>
                </div>
              ))}
            </dl>
            <section>
              <h3 className="mb-2 font-medium">Update history</h3>
              {!sku.history?.length ? (
                <p className="text-sm text-muted-foreground">No history has been recorded yet.</p>
              ) : (
                <TableGrid variant="nested" columns={SKU_HISTORY_COLUMNS} minWidth="54rem">
                  {sku.history.map((entry) => (
                    <tr key={entry.sku_history_id} className="h-11 border-b border-lavander/80 last:border-b-0">
                      <td className="px-4 py-2">
                        <StatusPill tone={ACTION_TONES[entry.action]}>
                          <span className="capitalize">{entry.action}</span>
                        </StatusPill>
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">{formatDateTime(entry.changed_at)}</td>
                      <td className="truncate px-4 py-2" title={entry.product_name}>{entry.product_name}</td>
                      <td className="truncate px-4 py-2" title={entry.sku_range}>{entry.sku_range}</td>
                      <td className="px-4 py-2">{entry.size}</td>
                      <td className="px-4 py-2 tabular-nums">{entry.pack_size}</td>
                      <td className="px-4 py-2 tabular-nums">{money.format(Number(entry.price))}</td>
                    </tr>
                  ))}
                </TableGrid>
              )}
            </section>
          </>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          {sku && <Button onClick={() => onEdit(sku)}>Edit SKU</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
