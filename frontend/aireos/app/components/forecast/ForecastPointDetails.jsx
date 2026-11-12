'use client';

import { cn } from '@/lib/utils';

/**
 * Label/value lines explaining a month: a missing or partial Actual, the
 * Current forecast's promo situation and price, when the Previous values were
 * made (forecastView.forecastPointDetails). Shared by the chart tooltip and
 * the promo panel, which replaces the tooltip in promo months. Confidence has
 * its own section (ForecastConfidenceDetails); the model is the whole line's,
 * so no row names it. A label can repeat (one Previous line per SKU).
 *
 * `hint` is hover text for a value.
 *
 * @param {{ details: { label: string, value: string, hint?: string }[], className?: string }} props
 */
export default function ForecastPointDetails({ details, className }) {
  if (!details?.length) return null;
  return (
    <dl className={cn('grid grid-cols-[5.5rem_1fr] gap-x-2 gap-y-1 text-[11px]', className)}>
      {details.map((detail, index) => (
        <div key={`${detail.label}-${index}`} className="contents">
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-deep-violet-blue/45">
            {detail.label}
          </dt>
          <dd
            className={cn('font-medium text-deep-violet-blue', detail.hint && 'cursor-help underline decoration-dotted underline-offset-2')}
            title={detail.hint || undefined}
          >
            {detail.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
