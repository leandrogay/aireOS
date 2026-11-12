'use client';

import { useState } from 'react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { hintClass, labelClass } from '@/components/ui/formStyles';
import SelectDropdown from '@/components/ui/SelectDropdown';
import { overwritePromoAnchor } from '@/app/services/promoUpliftsApi';
import { monthText } from '@/app/utils/promoUpliftCalc';
import { anchorLabel } from '@/app/utils/promoUpliftSettings';
import { singaporeToday } from '@/lib/singaporeTime';

/**
 * Overwrite a customer's (or SKU range's) anchor with a mechanic its
 * official promotions already use (the entry's `mechanic_options`, backend
 * promo_uplifts._mechanic_options), from this month on. A mechanic nobody has
 * run yet is added on the Promotions page first, so the picker only offers
 * real ones. Projected changes from official promotions still apply later.
 * A dialog, opened from PromoAnchorDetails or the row's "..." menu.
 *
 * @param {object} props
 * @param {{ key: string, customerId: number, skuRange: string | null, name: string, row: object }} props.target
 * @param {(result: object) => void} props.onSaved
 * @param {() => void} props.onCancel
 */
export default function PromoAnchorOverwriteForm({ target, onSaved, onCancel }) {
  const options = target.row.mechanic_options ?? [];
  const [mechanicKey, setMechanicKey] = useState(target.row.mechanic_key ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [requestError, setRequestError] = useState(null);
  const today = singaporeToday();
  const thisMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
  const chosen = options.some((option) => option.mechanic_key === mechanicKey);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!chosen) return;
    setSubmitting(true);
    setRequestError(null);
    try {
      onSaved(await overwritePromoAnchor(target.customerId, mechanicKey, target.skuRange));
    } catch (err) {
      setRequestError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!next && !submitting) onCancel(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Overwrite anchor · {target.name}</DialogTitle>
          <DialogDescription>
            Months at this mechanic become the ordinary months uplifts are measured against.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <fieldset disabled={submitting}>
            {options.length ? (
              <>
                <label htmlFor="anchor-mechanic" className={labelClass}>
                  Mechanic
                </label>
                <SelectDropdown
                  id="anchor-mechanic"
                  value={mechanicKey}
                  onChange={setMechanicKey}
                  placeholder="Pick a mechanic"
                  options={options.map((option) => ({
                    value: option.mechanic_key,
                    label: anchorLabel(option),
                  }))}
                />
              </>
            ) : (
              <p className="text-sm text-deep-violet-blue/70">No official promotions for this customer and SKU range yet.</p>
            )}
            <p className={hintClass}>
              Only mechanics used in official promotions for this customer and SKU range can be anchors. Add a
              promotion with this mechanic on the{' '}
              <Link href="/promotions" className="font-medium underline underline-offset-2">Promotions page</Link>{' '}
              first.
            </p>
            <p className={hintClass}>Applies from {monthText(thisMonth)}; past months keep their anchor.</p>
          </fieldset>

          <DialogFooter className="mt-4 items-center sm:justify-between">
            <p className="text-xs text-red-700" role="status">
              {requestError}
            </p>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting || !chosen}>
                {submitting ? 'Saving…' : 'Save anchor'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
