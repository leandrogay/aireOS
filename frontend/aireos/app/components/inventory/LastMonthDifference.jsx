import { formatMonth, formatUnits } from '@/app/utils/inventoryForm';

import { StatTag } from './InventoryChrome';

// What each comparison was measured against (backend forecast_source).
export const SOURCE_LABEL = {
  sell_in: {
    previous: 'Sell-in Forecast (Previous)',
    initial: 'Initial Yearly Sell-in Forecast',
    mixed: 'Sell-in Forecast (Previous) + Initial',
  },
  sell_out: {
    current: 'Sell-out Forecast (Current)',
    initial: 'Initial Yearly Sell-out Forecast',
    mixed: 'Current + Initial',
  },
};

/**
 * "+302 units (+10.5%) above forecast" for one comparison.
 *
 * @param {{ difference: number, percent: number | null }} comparison
 * @returns {string}
 */
export function differenceText({ difference, percent }) {
  const sign = difference > 0 ? '+' : difference < 0 ? '−' : '';
  const share = percent === null ? '' : ` (${sign}${Math.abs(percent).toFixed(2)}%)`;
  const direction = difference > 0 ? 'above' : difference < 0 ? 'below' : 'on';
  return `${sign}${formatUnits(Math.abs(difference))} units${share} ${direction} forecast`;
}

/**
 * What the difference was worked out from, for the pill's hover text: both
 * figures, the forecast they were measured against, and the SKUs counted
 * when some had no forecast.
 */
function detailText(kind, comparison) {
  const skus =
    comparison.skus_compared < comparison.skus_with_actuals
      ? ` Over ${comparison.skus_compared} of ${comparison.skus_with_actuals} SKUs (the rest have no forecast).`
      : '';
  return (
    `Actual ${formatUnits(comparison.actual)} units against ${formatUnits(comparison.forecast)} units ` +
    `(${SOURCE_LABEL[kind][comparison.forecast_source]}).${skus}`
  );
}

/**
 * The latest actual month's sell-in and sell-out against their forecasts
 * (backend get_sell_in_outlook's last_month_sell_in_vs_forecast and
 * last_month_vs_forecast), as one line of pills: the difference only, the
 * figures behind it on hover. Renders nothing when neither can be compared.
 *
 * @param {{ sellIn: object | null, sellOut: object | null }} props
 */
export default function LastMonthDifference({ sellIn, sellOut }) {
  const rows = [
    { kind: 'sell_in', label: 'Sell-in', comparison: sellIn },
    { kind: 'sell_out', label: 'Sell-out', comparison: sellOut },
  ].filter((row) => row.comparison);
  if (rows.length === 0) return null;

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2" role="status">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-deep-violet-blue/50">
        {formatMonth(rows[0].comparison.month)} vs forecast
      </p>
      <div className="flex flex-wrap gap-1.5">
        {rows.map((row) => (
          <span key={row.kind} title={detailText(row.kind, row.comparison)}>
            <StatTag label={row.label} value={differenceText(row.comparison)} />
          </span>
        ))}
      </div>
    </div>
  );
}
