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
import { cn } from '@/lib/utils';

import { SKU_CELL_CLASS, SKU_HISTORY_COLUMNS } from './columns';

const money = new Intl.NumberFormat('en-SG', { style: 'currency', currency: 'SGD' });
const ACTION_TONES = { created: 'success', updated: 'info', archived: 'muted' };

export default function SkuDetails({ open, sku, loading, error, onClose }) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[min(72rem,calc(100%-2rem))]">
        <DialogHeader>
          <DialogTitle>{sku ? `History · ${sku.sku}` : 'SKU history'}</DialogTitle>
          <DialogDescription>
            {sku?.product_name
              ? `Audit trail for ${sku.product_name}.`
              : 'Recorded changes to this SKU.'}
          </DialogDescription>
        </DialogHeader>
        {loading && <p className="py-10 text-center text-muted-foreground">Loading history...</p>}
        {error && (
          <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        )}
        {!loading && !error && sku && (
          !sku.history?.length ? (
            <p className="rounded-md border border-lavander bg-cream/40 px-4 py-10 text-center text-sm text-muted-foreground">
              No history has been recorded yet.
            </p>
          ) : (
            <TableGrid variant="nested" columns={SKU_HISTORY_COLUMNS} minWidth="68rem">
              {sku.history.map((entry) => (
                <tr key={entry.sku_history_id} className="h-11 border-b border-lavander/80 last:border-b-0">
                  <td className="px-4 py-2">
                    <StatusPill tone={ACTION_TONES[entry.action]}>
                      <span className="capitalize">{entry.action}</span>
                    </StatusPill>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{formatDateTime(entry.changed_at)}</td>
                  <td className={cn(SKU_CELL_CLASS, 'px-4 py-2')}>{entry.product_name}</td>
                  <td className={cn(SKU_CELL_CLASS, 'px-4 py-2')}>{entry.sku_range}</td>
                  <td className={cn(SKU_CELL_CLASS, 'px-4 py-2')}>{entry.size}</td>
                  <td className={cn(SKU_CELL_CLASS, 'px-4 py-2')}>{entry.brand}</td>
                  <td className={cn(SKU_CELL_CLASS, 'px-4 py-2')}>{entry.uom}</td>
                  <td className={cn(SKU_CELL_CLASS, 'px-4 py-2 tabular-nums')}>{entry.pack_size}</td>
                  <td className={cn(SKU_CELL_CLASS, 'px-4 py-2 tabular-nums')}>{money.format(Number(entry.price))}</td>
                </tr>
              ))}
            </TableGrid>
          )
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
