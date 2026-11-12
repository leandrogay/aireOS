'use client';

import ScenarioDateFields from '@/components/scenario/ScenarioDateFields';
import { blockMonthOptions } from '@/app/utils/scenarioBlocks';
import { promotionDayOptions } from '@/app/utils/scenarioDateOptions';
import { formatMonthLabel } from '@/app/utils/forecastView';
import { SIDE_OFFER_TYPE } from '@/app/utils/scenarioPromotions';
import { formatDate } from '@/lib/formatDate';

/**
 * A side offer uses exact calendar days; other promotions use whole months.
 * Both use the same searchable date controls and keep off-chart saved dates.
 *
 * @param {{ promotion: object, months: string[], onUpdate: (changes: object) => void }} props
 */
export default function PromotionDateFields({ promotion, months, onUpdate }) {
  const daily = promotion.promoType === SIDE_OFFER_TYPE;
  const options = daily
    ? promotionDayOptions(months, [promotion.startDate, promotion.endDate]).map(({ date, locked }) => ({
      value: date,
      label: `${formatDate(date)}${locked ? ' (off the chart)' : ''}`,
      disabled: locked,
    }))
    : blockMonthOptions(promotion, months).map(({ month, locked }) => ({
      value: month,
      label: `${formatMonthLabel(month)}${locked ? ' (off the chart)' : ''}`,
      disabled: locked,
    }));

  return (
    <div>
      <ScenarioDateFields
        id="promo"
        start={daily ? promotion.startDate : promotion.startMonth}
        end={daily ? promotion.endDate : promotion.endMonth}
        onStartChange={(value) => onUpdate(daily ? { startDate: value } : { startMonth: value })}
        onEndChange={(value) => onUpdate(daily ? { endDate: value } : { endMonth: value })}
        options={options}
        constrainRange={daily}
      />
      {daily ? (
        <p className="mt-1 text-[11px] text-deep-violet-blue/50">
          A side offer adds its uplift for the days it runs: 1–10 Nov adds a third of it to November.
        </p>
      ) : null}
    </div>
  );
}
