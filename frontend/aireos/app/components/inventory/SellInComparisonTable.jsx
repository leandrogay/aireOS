import { ChangeValue } from '@/components/ui/ComparisonFigures';
import { formatMonth, formatUnits } from '@/app/utils/inventoryForm';
import { cn } from '@/lib/utils';

import { inventoryTdClass, inventoryThClass } from './InventoryTableFrame';
import { SOURCE_LABEL } from './LastMonthDifference';

const numClass = 'text-right tabular-nums';
const groupStartClass = 'border-l border-lavander';

const SIDES = [
  { kind: 'sell_in', key: 'sellIn', label: 'Sell-in' },
  { kind: 'sell_out', key: 'sellOut', label: 'Sell-out' },
];

function signedUnits(value) {
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${formatUnits(Math.abs(value))}`;
}

// One side's three cells for one month: actual, forecast (what it was
// measured against on hover) and the difference.
function SideCells({ kind, comparison }) {
  if (!comparison) {
    return (
      <td className={cn(inventoryTdClass, groupStartClass, 'text-deep-violet-blue/50')} colSpan={3}>
        No forecast for this month
      </td>
    );
  }
  return (
    <>
      <td className={cn(inventoryTdClass, groupStartClass, numClass)}>{formatUnits(comparison.actual)}</td>
      <td className={cn(inventoryTdClass, numClass)} title={`Measured against ${SOURCE_LABEL[kind][comparison.source]}`}>
        {formatUnits(comparison.forecast)}
      </td>
      <td className={cn(inventoryTdClass, numClass)}>
        <ChangeValue pct={comparison.percent} decimals={2} />
        <span className="block text-[11px] text-deep-violet-blue/60">{signedUnits(comparison.difference)} units</span>
      </td>
    </>
  );
}

/**
 * The months picked on the sell-in plan chart, one row each, so each month's
 * miss can be read against the others instead of disappearing into one total
 * (utils/sellInComparison monthlyComparison). Units are cartons; a forecast's
 * hover text names the forecast that month was measured against.
 *
 * @param {{ rows: { month: string, sellIn: object | null, sellOut: object | null }[] }} props
 */
export default function SellInComparisonTable({ rows }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm text-deep-violet-blue [&_td]:align-middle [&_th]:align-middle">
        <thead>
          <tr className="bg-cream/60">
            <th className={inventoryThClass} rowSpan={2}>
              Month
            </th>
            {SIDES.map((side) => (
              <th key={side.kind} className={cn(inventoryThClass, groupStartClass, 'text-center')} colSpan={3}>
                {side.label}
              </th>
            ))}
          </tr>
          <tr className="bg-cream/60 [&>th]:shadow-[inset_0_-1px_0_var(--color-lavander)]">
            {SIDES.map((side) => [
              <th key={`${side.kind}-actual`} className={cn(inventoryThClass, groupStartClass, numClass)}>
                Actual
              </th>,
              <th key={`${side.kind}-forecast`} className={cn(inventoryThClass, numClass)}>
                Forecast
              </th>,
              <th key={`${side.kind}-vs`} className={cn(inventoryThClass, numClass)}>
                vs forecast
              </th>,
            ])}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.month} className="border-b border-lavander/80 last:border-b-0">
              <td className={cn(inventoryTdClass, 'font-medium')}>{formatMonth(row.month)}</td>
              {SIDES.map((side) => (
                <SideCells key={side.kind} kind={side.kind} comparison={row[side.key]} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
