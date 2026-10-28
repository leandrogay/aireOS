'use client';

import { History, Pencil, RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import InfoTooltip from '@/components/ui/InfoTooltip';
import { cardClass, secondaryButtonClass } from '@/components/inventory/formStyles';
import { DEFAULT_UPLIFT_PER_POINT_PCT, ruleExample } from '@/app/utils/promoUpliftSettings';
import { PROMO_HINTS } from '@/app/utils/promoUpliftHints';

/**
 * The rule behind rule-based uplifts, as one sentence with its rate and a
 * worked example ("5 points deeper than normal -> +2%"), next to the
 * ordinary-month discounts. Edit opens PromoRuleDialog; History and Reset to
 * default are dialogs and actions the view owns.
 *
 * @param {object} props
 * @param {object | null} props.rule `rule` from getPromoUpliftSettings
 * @param {boolean} props.readOnly no buttons
 * @param {() => void} props.onEdit
 * @param {() => void} props.onHistory
 * @param {() => void} props.onReset
 */
export default function PromoRuleCard({ rule, readOnly, onEdit, onHistory, onReset }) {
  const rate = rule?.uplift_per_point_pct ?? DEFAULT_UPLIFT_PER_POINT_PCT;

  return (
    <section className={cardClass}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="max-w-2xl">
          <h2 className="flex items-center gap-1 text-sm font-medium text-deep-violet-blue">
            Rule for rule-based uplifts
            <InfoTooltip label="About the rule" className="w-80">{PROMO_HINTS.rule}</InfoTooltip>
          </h2>
          <p className="mt-1 text-sm text-deep-violet-blue/90">
            Assume sales rise <b className="tabular-nums">{rate}%</b> for every extra percentage point of discount deeper
            than the customer&apos;s normal discount.
          </p>
          <p className="mt-0.5 text-xs text-deep-violet-blue/60">
            For example, 5 points deeper than normal → {ruleExample(rate)}. One rate for all customers (default{' '}
            {DEFAULT_UPLIFT_PER_POINT_PCT}%).
          </p>
          {rule?.warning ? (
            <p className="mt-1 text-xs text-amber-800" role="status">{rule.warning}</p>
          ) : null}
        </div>
        {readOnly ? null : (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onEdit} className={secondaryButtonClass}>
              <Pencil aria-hidden="true" />
              Edit
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={onHistory} className={secondaryButtonClass}>
              <History aria-hidden="true" />
              History
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onReset}
              disabled={rule?.is_default ?? true}
              className={secondaryButtonClass}
            >
              <RotateCcw aria-hidden="true" />
              Reset to default
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
