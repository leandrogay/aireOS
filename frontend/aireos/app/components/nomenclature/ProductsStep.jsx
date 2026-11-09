'use client';

import { useState } from 'react';
import Link from 'next/link';

import Disclosure from '@/components/ui/Disclosure';

import ResetButton from '../mappings/ResetButton';
import SkuCodeTable from '../mappings/SkuCodeTable';

/**
 * "Which product is each code?": the codes that are not one of our master
 * SKUs, on their own, to pick a product for; the codes already matched folded
 * underneath, still changeable. Which codes are asked is fixed when the screen
 * opens, so a code stays put once its product is picked.
 *
 * @param {{
 *   review: ReturnType<import('@/hooks/useGuidedReview').default>,
 *   mapping: object,
 *   onResetStep: () => void,
 *   disabled: boolean,
 * }} props
 */
export default function ProductsStep({ review, mapping, onResetStep, disabled }) {
  const { edits, codes, unknown, masterAvailable, changedCodes } = review;
  const [asked] = useState(() => new Set(unknown));
  const askedRows = codes.filter((row) => asked.has(row.code));
  const otherRows = codes.filter((row) => !asked.has(row.code));
  const left = unknown.length;

  const table = (rows) => (
    <SkuCodeTable
      rows={rows}
      masterSkus={mapping.masterSkus || []}
      masterAvailable={masterAvailable}
      onChange={edits.setSkuCode}
      codeChanged={edits.codeChanged}
      onResetCode={(code) => edits.resetSkuCodes([code])}
      readOnly={disabled}
    />
  );

  return (
    <>
      {askedRows.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm text-deep-violet-blue">
            {left
              ? `${left} of ${askedRows.length} still ${left === 1 ? 'needs' : 'need'} a product.`
              : `All ${askedRows.length} matched. Nice.`}{' '}
            <span className="text-deep-violet-blue/80">
              Missing a product? Add it on the{' '}
              <Link href="/skus" target="_blank" className="font-medium underline underline-offset-2">
                SKUs page
              </Link>{' '}
              first.
            </span>
          </p>
          {table(askedRows)}
        </div>
      )}

      {!askedRows.length && table(codes)}

      {askedRows.length > 0 && otherRows.length > 0 && (
        <Disclosure
          className="rounded-lg border border-lavander bg-white"
          summary={
            <>
              {otherRows.length} codes already matched
              <span className="font-normal text-deep-violet-blue/80"> · change any of them</span>
            </>
          }
        >
          <div className="border-t border-lavander p-2">{table(otherRows)}</div>
        </Disclosure>
      )}

      {changedCodes.length > 0 && (
        <div className="flex justify-end">
          <ResetButton
            text="Undo my changes on this screen"
            label="Put every product code back as the AI proposed it"
            onClick={onResetStep}
            disabled={disabled}
            className="text-sm text-deep-violet-blue"
          />
        </div>
      )}
    </>
  );
}
