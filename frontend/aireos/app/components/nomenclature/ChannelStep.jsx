'use client';

import { CheckCircle2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { canRenameOutputs, retailerChoices } from '@/app/utils/mappingCustomer';
import { needsConfirm } from '@/app/utils/mappingReview';
import { customerLabel } from '@/app/utils/retailerLabel';
import { splitFromDecision } from '@/app/utils/retailerSplit';

import ChannelSplit from '../mappings/ChannelSplit';
import { RetailerLine } from '../mappings/CustomerStep';

// The retailer decisions ChannelSplit shows whole (retailerSplit.splitFromDecision).
const SPLIT_MODES = ['offline', 'online', 'split'];

/**
 * "Where do these sales go?": all offline, all online, or split by a column
 * (ChannelSplit, the same picker as the full review), then any retailer that
 * is not the customer's yet, with its one-click fix. A mapping that writes the
 * retailer its own way keeps its rule-by-rule lines, each still changeable.
 *
 * @param {{ review: ReturnType<import('@/hooks/useGuidedReview').default>, mapping: object, disabled: boolean }} props
 */
export default function ChannelStep({ review, mapping, disabled }) {
  const { customer, decision, outputs, statuses, edits, layout } = review;

  if (!customer) {
    return <p className="text-sm text-deep-violet-blue/80">Choose the customer first, on the step before.</p>;
  }

  const retailers = customer.retailers || [];
  const picked = SPLIT_MODES.includes(splitFromDecision(decision).mode);
  const choices = canRenameOutputs(decision) ? retailerChoices(decision) : [];
  const statusOf = (retailerName) =>
    statuses.find((item) => item.name === retailerName) || { name: retailerName, status: null };
  // Another customer's retailer is flagged, with its fix, by the picker itself.
  const problems = statuses.filter((item) => item.status !== 'ok' && item.status !== 'other');
  const retailerEntry = review.issues.coverage.find((entry) => entry.field === 'retailer');
  const unsure = retailerEntry && needsConfirm(retailerEntry);

  return (
    <>
      {!retailers.length && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {customerLabel(customer.customer_name)} has no retailers yet. Choose how the rows split, then add the retailers
          it needs below.
        </p>
      )}

      <div className="rounded-lg border border-lavander p-3">
        {/* Remounted when the decision or customer changes, so it starts from
            what the mapping does now. */}
        <ChannelSplit
          key={`${customer.customer_id}:${JSON.stringify(decision.transforms)}:${decision.value ?? ''}:${decision.kind}`}
          customer={customer}
          decision={decision}
          outputs={outputs}
          mapping={mapping}
          state={edits.state}
          layout={layout}
          onApply={(retailer) => edits.setFieldDecision('retailer', retailer)}
          disabled={disabled}
        />
      </div>

      {picked && problems.length > 0 && (
        <ul className="space-y-1.5">
          {problems.map((item) => (
            <RetailerLine
              key={item.name}
              item={item}
              customerName={customer.customer_name}
              retailers={retailers}
              onFix={review.fixRetailer}
              disabled={disabled}
            />
          ))}
        </ul>
      )}

      {!picked && choices.length > 0 && (
        <ul className="space-y-1.5">
          {choices.map((choice) => (
            <RetailerLine
              key={choice.key}
              item={statusOf(choice.output)}
              choice={choice}
              customerName={customer.customer_name}
              retailers={retailers}
              onChoose={edits.setRetailerChoice}
              onFix={review.fixRetailer}
              disabled={disabled}
            />
          ))}
        </ul>
      )}

      {!picked && !choices.length && statuses.length > 0 && (
        <ul className="space-y-1.5">
          {statuses.map((item) => (
            <RetailerLine
              key={item.name}
              item={item}
              customerName={customer.customer_name}
              retailers={retailers}
              onFix={review.fixRetailer}
              disabled={disabled}
            />
          ))}
        </ul>
      )}

      {/* The retailer is signed off here, with the rest of where sales go. */}
      {unsure && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
          <p className="text-sm text-amber-900">The AI wasn’t sure about the retailer. Does the split above look right?</p>
          <Button type="button" variant="outline" size="sm" onClick={() => edits.confirmField(retailerEntry)} disabled={disabled}>
            <CheckCircle2 aria-hidden="true" />
            Looks right
          </Button>
        </div>
      )}
    </>
  );
}
