'use client';

import { cn } from '@/lib/utils';

/**
 * Label/value lines explaining a month's Current forecast (model, 80% range,
 * confidence, promo situation, price). Shared by the chart tooltip and the
 * promo panel, which replaces the tooltip in promo months.
 *
 * `hint` is hover text for a value (e.g. why Tier 0 was used).
 *
 * @param {{ details: { label: string, value: string, hint?: string }[], className?: string }} props
 */
export default function ForecastPointDetails({ details, className }) {
  if (!details?.length) return null;
  return (
    <dl className={cn('grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-1 text-[11px]', className)}>
      {details.map((detail) => (
        <div key={detail.label} className="contents">
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
