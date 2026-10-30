'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { errorClass, hintClass, inputClass, labelClass } from '@/components/inventory/formStyles';
import InfoTooltip from '@/components/ui/InfoTooltip';
import { savePromoRule } from '@/app/services/promoUpliftsApi';
import {
  DEFAULT_UPLIFT_PER_POINT_PCT,
  RULE_WARNING,
  RULE_WARNING_ABOVE_PCT,
  parseRateInput,
  ratePreview,
  ruleExample,
} from '@/app/utils/promoUpliftSettings';
import { PROMO_HINTS } from '@/app/utils/promoUpliftHints';

import RulePreviewTable from './RulePreviewTable';

/**
 * Edit the rule's rate in a dialog (Edit on the rule card): one number, a
 * live example, and a before/after preview of every rule-based uplift at the
 * anchor the page is showing. A rate above 1.0 warns but still saves; every
 * rule-based uplift is kept within -90..+300.
 *
 * @param {object} props
 * @param {number} props.currentRate the rate in use
 * @param {object[]} props.settings current setting rows
 * @param {number} props.anchorPct the anchor the preview is worked out at
 * @param {string} props.anchorLabel whose anchor that is, e.g. "Fairprice's ordinary-month discount"
 * @param {(save: Promise<object>) => Promise<object>} props.track counts the save as in flight (it may measure)
 * @param {(result: object) => void} props.onSaved
 * @param {() => void} props.onCancel
 */
export default function PromoRuleDialog({ track, currentRate, settings, anchorPct, anchorLabel, onSaved, onCancel }) {
  const [text, setText] = useState(String(currentRate));
  const [submitting, setSubmitting] = useState(false);
  const [requestError, setRequestError] = useState(null);
  const { value, error } = parseRateInput(text);
  const shownRate = value ?? currentRate;
  const preview = ratePreview(settings, anchorPct, currentRate, shownRate);
  const tooHigh = value != null && value > RULE_WARNING_ABOVE_PCT;

  async function handleSubmit(event) {
    event.preventDefault();
    if (value == null) return;
    setSubmitting(true);
    setRequestError(null);
    try {
      onSaved(await track(savePromoRule(value)));
    } catch (err) {
      setRequestError(err.message);
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!next && !submitting) onCancel(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit the rule</DialogTitle>
          <DialogDescription>
            One rate for all customers. Rule-based uplift = (promotion&apos;s discount − customer&apos;s normal discount)
            × this rate, to a whole percent. Measured and typed uplifts don&apos;t change; saved Scenario builder promotions keep the uplift they
            were saved with.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="grid gap-4">
          <div>
            <span className="flex items-center gap-1">
              <label htmlFor="rule-rate" className={labelClass}>
                Sales rise per extra point of discount (%)
              </label>
              <InfoTooltip label="How the rate is used" className="w-80">{PROMO_HINTS.ruleRate}</InfoTooltip>
            </span>
            <input
              id="rule-rate"
              inputMode="decimal"
              value={text}
              disabled={submitting}
              aria-invalid={Boolean(error)}
              onChange={(event) => setText(event.target.value)}
              className={inputClass}
            />
            {error ? (
              <p className={errorClass}>{error}</p>
            ) : (
              <p className={hintClass}>
                For example, 5 points deeper than normal → {ruleExample(shownRate)}. Default {DEFAULT_UPLIFT_PER_POINT_PCT}.
              </p>
            )}
            {tooHigh ? (
              <p className="mt-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900" role="status">
                {RULE_WARNING}
              </p>
            ) : null}
          </div>

          <div className="grid gap-1">
            <p className="text-xs text-deep-violet-blue/70">Preview at {anchorLabel} ({anchorPct}%):</p>
            <RulePreviewTable rows={preview} />
          </div>

          {requestError ? (
            <p className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">{requestError}</p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>Cancel</Button>
            <Button type="submit" disabled={submitting || value == null}>
              {submitting ? 'Saving…' : 'Save rule'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
