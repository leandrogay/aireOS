'use client';

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import DatePicker from '@/components/ui/DatePicker';
import StatusPill from '@/components/ui/StatusPill';
import TableGrid from '@/components/ui/TableGrid';
import TableRow from '@/components/ui/TableRow';
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

import {
  SKU_CELL_CLASS,
  SKU_HISTORY_COLUMNS,
  SKU_PRICE_CORRECTION_COLUMNS,
  SKU_PRICE_PERIOD_COLUMNS,
} from './columns';

const money = new Intl.NumberFormat('en-SG', { style: 'currency', currency: 'SGD' });
const ACTION_TONES = { created: 'success', updated: 'info', archived: 'muted' };

function dateRange(from, to) {
  return `${from} – ${to || 'Until changed'}`;
}

function shiftDay(isoDate, days) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function findPriceGaps(periods) {
  const ordered = [...periods]
    .filter((period) => /^\d{4}-\d{2}-\d{2}$/.test(period.effective_from || ''))
    .sort((left, right) => left.effective_from.localeCompare(right.effective_from));
  const gaps = [];

  for (let index = 1; index < ordered.length; index += 1) {
    const previousEnd = ordered[index - 1].effective_to;
    if (!previousEnd) continue;
    const from = shiftDay(previousEnd, 1);
    const to = shiftDay(ordered[index].effective_from, -1);
    if (from <= to) gaps.push({ from, to });
  }

  const finalEnd = ordered.at(-1)?.effective_to;
  if (finalEnd) gaps.push({ from: shiftDay(finalEnd, 1), to: null });
  return gaps;
}

export default function SkuDetails({ open, sku, loading, error, onCorrectPricePeriod, onClose }) {
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const periods = sku?.price_periods || [];
  const shownPeriods = periods.map((period) =>
    editing?.periodId === period.price_period_id && editing.effective_from
      ? { ...period, effective_from: editing.effective_from,
          effective_to: editing.effective_to || null }
      : period,
  );
  const priceGaps = findPriceGaps(shownPeriods);

  const startCorrection = (period) => {
    setEditing({
      periodId: period.price_period_id,
      price: String(period.price),
      effective_from: period.effective_from,
      effective_to: period.effective_to || '',
    });
    setSaveError('');
  };

  const saveCorrection = async () => {
    if (!/^\d+(\.\d{1,2})?$/.test(editing.price) ||
        !editing.effective_from ||
        (editing.effective_to && editing.effective_to < editing.effective_from)) {
      setSaveError('Enter a valid price and dates; the end date cannot precede the start date.');
      return;
    }
    setSaving(true);
    setSaveError('');
    try {
      await onCorrectPricePeriod(editing.periodId, {
        price: editing.price,
        effective_from: editing.effective_from,
        effective_to: editing.effective_to || null,
      });
      setEditing(null);
    } catch (saveFailure) {
      setSaveError(saveFailure.message || 'Could not correct price dates.');
    } finally {
      setSaving(false);
    }
  };

  const closeDetails = () => {
    setEditing(null);
    setSaveError('');
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) closeDetails(); }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[min(72rem,calc(100%-2rem))]">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl text-deep-violet-blue">{sku ? `History · ${sku.sku}` : 'SKU history'}</DialogTitle>
          <DialogDescription className="text-xs text-deep-violet-blue/65">
            {sku?.product_name
              ? `Audit trail for ${sku.product_name}.`
              : 'Recorded changes to this SKU.'}
          </DialogDescription>
        </DialogHeader>
        {loading && <p className="py-10 text-center text-sm text-deep-violet-blue/70">Loading history...</p>}
        {error && (
          <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        )}
        {!loading && !error && sku && (
          <div className="min-w-0 space-y-5">
            <section className="min-w-0 space-y-2">
              <h3 className="text-sm font-semibold text-deep-violet-blue">Price periods</h3>
              <p className="text-xs text-deep-violet-blue/65">
                Correct a saved price or date entered by mistake. This may change past calculated revenue; supplied revenue stays the same.
              </p>
              {priceGaps.length > 0 && (
                <div role="status" className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  <AlertTriangle aria-hidden="true" className="mt-px size-4 shrink-0" />
                  <div>
                    <p className="font-semibold">Missing effective price {priceGaps.length === 1 ? 'period' : 'periods'}</p>
                    <ul className="mt-1 list-disc pl-4">
                      {priceGaps.map((gap) => (
                        <li key={`${gap.from}-${gap.to || 'open'}`}>
                          {gap.to === gap.from
                            ? `No price on ${gap.from}`
                            : `No price from ${gap.from} ${gap.to ? `through ${gap.to}` : 'onward'}`}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-1">Calculated revenue may be unavailable for sales in these periods. You can still save.</p>
                  </div>
                </div>
              )}
              <TableGrid
                variant="nested"
                columns={SKU_PRICE_PERIOD_COLUMNS}
                minWidth="48rem"
                emptyState={!sku.price_periods?.length
                  ? 'No price periods available. Ask an administrator to reconcile the price history.'
                  : null}
              >
                {periods.map((period) => (
                  <TableRow key={period.price_period_id} className="border-b border-lavander/80 last:border-b-0">
                    <td className="px-4 py-2 tabular-nums">
                      {editing?.periodId === period.price_period_id ? (
                        <input
                          type="number"
                          aria-label="Correct price"
                          min="0"
                          step="0.01"
                          value={editing.price}
                          onChange={(event) => setEditing({ ...editing, price: event.target.value })}
                          className="w-full rounded-md border border-lavander bg-cream px-2 py-1 text-sm text-deep-violet-blue"
                        />
                      ) : money.format(Number(period.price))}
                    </td>
                    <td className="px-4 py-2">
                      {editing?.periodId === period.price_period_id ? (
                        <DatePicker
                          variant="input"
                          ariaLabel="Correct effective from"
                          value={editing.effective_from}
                          onChange={(value) => setEditing({ ...editing, effective_from: value })}
                          boxClassName="bg-cream"
                        />
                      ) : period.effective_from}
                    </td>
                    <td className="px-4 py-2">
                      {editing?.periodId === period.price_period_id ? (
                        <DatePicker
                          variant="input"
                          ariaLabel="Correct effective to"
                          value={editing.effective_to}
                          min={editing.effective_from || ''}
                          onChange={(value) => setEditing({ ...editing, effective_to: value })}
                          boxClassName="bg-cream"
                        />
                      ) : (period.effective_to || 'Until changed')}
                    </td>
                    <td className="px-4 py-2">
                      {editing?.periodId === period.price_period_id ? (
                        <div className="flex gap-1">
                          <Button size="sm" disabled={saving} onClick={saveCorrection}>Save</Button>
                          <Button size="sm" variant="outline" disabled={saving} onClick={() => setEditing(null)}>Cancel</Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => startCorrection(period)}>Edit</Button>
                      )}
                    </td>
                  </TableRow>
                ))}
              </TableGrid>
              {saveError && <p className="text-xs text-red-700" role="alert">{saveError}</p>}
            </section>

            {(sku.price_corrections || []).length > 0 && (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-deep-violet-blue">Price corrections</h3>
                <TableGrid variant="nested" columns={SKU_PRICE_CORRECTION_COLUMNS} minWidth="48rem">
                  {sku.price_corrections.map((correction) => (
                    <TableRow key={correction.correction_id} className="border-b border-lavander/80 last:border-b-0">
                      <td className="px-4 py-2">{formatDateTime(correction.corrected_at)}</td>
                      <td className="px-4 py-2">{money.format(Number(correction.old_price))} · {dateRange(correction.old_effective_from, correction.old_effective_to)}</td>
                      <td className="px-4 py-2">{money.format(Number(correction.new_price))} · {dateRange(correction.new_effective_from, correction.new_effective_to)}</td>
                      <td className="px-4 py-2 break-all">{correction.corrected_by}</td>
                    </TableRow>
                  ))}
                </TableGrid>
              </section>
            )}

            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-deep-violet-blue">SKU audit trail</h3>
              {!sku.history?.length ? (
                <p className="rounded-md border border-lavander bg-cream/40 px-4 py-10 text-center text-sm text-deep-violet-blue/80">
                  No history has been recorded yet.
                </p>
              ) : (
                <TableGrid variant="nested" columns={SKU_HISTORY_COLUMNS} minWidth="84rem">
                  {sku.history.map((entry) => (
                    <TableRow key={entry.sku_history_id} className="h-11 border-b border-lavander/80 last:border-b-0">
                      <td className="px-4 py-2">
                        <StatusPill tone={ACTION_TONES[entry.action]}>
                          <span className="capitalize">{entry.action}</span>
                        </StatusPill>
                      </td>
                      <td className="px-4 py-2 text-deep-violet-blue/70">{formatDateTime(entry.changed_at)}</td>
                      <td className={cn(SKU_CELL_CLASS, 'px-4 py-2')}>{entry.product_name}</td>
                      <td className={cn(SKU_CELL_CLASS, 'px-4 py-2')}>{entry.sku_range}</td>
                      <td className={cn(SKU_CELL_CLASS, 'px-4 py-2')}>{entry.size}</td>
                      <td className={cn(SKU_CELL_CLASS, 'px-4 py-2')}>{entry.brand}</td>
                      <td className={cn(SKU_CELL_CLASS, 'px-4 py-2')}>{entry.uom}</td>
                      <td className={cn(SKU_CELL_CLASS, 'px-4 py-2 text-right tabular-nums')}>{entry.pack_size}</td>
                      <td className={cn(SKU_CELL_CLASS, 'px-4 py-2 text-right tabular-nums')}>
                        {entry.price == null ? '—' : money.format(Number(entry.price))}
                      </td>
                      <td className="px-4 py-2 tabular-nums">{entry.price_effective_from || 'Legacy'}</td>
                      <td className="px-4 py-2 tabular-nums">
                        {entry.price_effective_from ? (entry.price_effective_to || 'Until changed') : '—'}
                      </td>
                    </TableRow>
                  ))}
                </TableGrid>
              )}
            </section>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={closeDetails}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
