import { ChangeFigure, ComparisonNote } from '@/components/ui/ComparisonFigures';
import { formatUnits } from '@/app/utils/inventoryForm';
import { monthlyComparison, monthsWithoutActuals, rangeComparison } from '@/app/utils/sellInComparison';

import { monthRangeLabel } from './InventoryChrome';
import { SOURCE_LABEL } from './LastMonthDifference';
import SellInComparisonTable from './SellInComparisonTable';

const SIDES = [
  { kind: 'sell_in', key: 'sell_in_vs_forecast', label: 'Sell-in' },
  { kind: 'sell_out', key: 'sell_out_vs_forecast', label: 'Sell-out' },
];

function signedUnits(value) {
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${formatUnits(Math.abs(value))} units`;
}

// One side's actual and forecast, a row each, as the dashboard card lists
// its two periods.
function SideRows({ label, kind, comparison }) {
  return (
    <div className="py-1.5">
      <p className="text-xs font-medium text-deep-violet-blue">{label}</p>
      {comparison ? (
        <dl className="mt-0.5 grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-xs">
          <dt className="text-ink-soft">Actual</dt>
          <dd className="text-right font-semibold tabular-nums text-deep-violet-blue">
            {formatUnits(comparison.actual)} units
          </dd>
          <dt className="text-ink-soft">Forecast · {SOURCE_LABEL[kind][comparison.source]}</dt>
          <dd className="text-right font-semibold tabular-nums text-deep-violet-blue">
            {formatUnits(comparison.forecast)} units
          </dd>
        </dl>
      ) : (
        <p className="mt-0.5 text-xs text-ink-soft">No forecast for these months</p>
      )}
    </div>
  );
}

/**
 * The months picked on the sell-in plan chart (zoom), actual against
 * forecast for sell-in and sell-out. One month is laid out like the
 * dashboard's Comparison card: the two differences as headline figures, then
 * each side's figures. Several months get a row each (SellInComparisonTable)
 * rather than one total, so the months can be told apart. Then any note.
 * Only months with actuals count, each SKU-matched (backend
 * get_sell_in_outlook, frontend utils/sellInComparison).
 *
 * @param {{ months: object[] }} props the picked rows of get_sell_in_outlook's `months`
 */
export default function SellInComparison({ months }) {
  const sides = SIDES.map((side) => ({ ...side, comparison: rangeComparison(months, side.key) }));
  const future = monthsWithoutActuals(months);
  const anyCompared = sides.some((side) => side.comparison);
  const perMonth = monthlyComparison(months);

  const notes = [];
  if (future.length === months.length) {
    notes.push('These months have no actuals yet, so there is nothing to compare. Pick months up to the last actual one.');
  } else if (future.length) {
    notes.push(`${monthRangeLabel(future[0], future[future.length - 1])}: no actuals yet, so left out.`);
  }
  if (sides.some((side) => side.comparison?.someSkusMissing)) {
    notes.push('SKUs with no forecast for a month are left out of that month, on both sides.');
  }

  return (
    <div className="aire-card p-3">
      <h3 className="font-serif text-base text-deep-violet-blue">Comparison</h3>
      <p className="mb-2 text-xs text-ink-soft">
        {monthRangeLabel(months[0].month, months[months.length - 1].month)} · actual vs forecast
      </p>

      {perMonth.length > 1 ? (
        <SellInComparisonTable rows={perMonth} />
      ) : anyCompared ? (
        <>
          <div className="flex gap-3">
            {sides.map((side) => (
              <ChangeFigure
                key={side.kind}
                label={`${side.label} vs forecast`}
                pct={side.comparison?.percent ?? null}
                decimals={2}
                detail={side.comparison ? signedUnits(side.comparison.difference) : undefined}
              />
            ))}
          </div>
          <div className="mt-2 divide-y divide-lavander border-t border-lavander">
            {sides.map((side) => (
              <SideRows key={side.kind} label={side.label} kind={side.kind} comparison={side.comparison} />
            ))}
          </div>
        </>
      ) : null}

      {notes.map((note) => (
        <ComparisonNote key={note}>{note}</ComparisonNote>
      ))}
    </div>
  );
}
