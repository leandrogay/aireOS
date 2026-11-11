import { ChangeValue } from '@/components/ui/ComparisonFigures';
import { HEADER_RULE } from '@/components/forecast/ForecastYearTotals';
import { formatMonth, formatUnits } from '@/app/utils/inventoryForm';
import { cn } from '@/lib/utils';

import { SOURCE_LABEL } from './LastMonthDifference';

// The compact actual-vs-forecast table style the Forecast page's year totals
// (ForecastYearTotals) and the Scenario builder's tables use: cream 10px
// uppercase headers with the darker HEADER_RULE lines, text-xs rows on the
// shared zebra and hover (aire-table-rows), a line before each group.
const headerClass = cn('border-b bg-cream text-[10px] font-bold uppercase tracking-wide text-deep-violet-blue', HEADER_RULE);
const splitHeaderClass = cn(
  'border-b border-l bg-cream px-2 py-1 text-right text-[10px] font-bold uppercase tracking-wide text-deep-violet-blue/80',
  HEADER_RULE,
);
const amountClass = 'whitespace-nowrap border-l border-lavander/80 px-2.5 py-2 text-right tabular-nums';

const SIDES = [
  { kind: 'sell_in', key: 'sellIn', label: 'Sell-in' },
  { kind: 'sell_out', key: 'sellOut', label: 'Sell-out' },
];

const SPLIT = ['Actual', 'Forecast', 'vs forecast'];

function signedUnits(value) {
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${formatUnits(Math.abs(value))}`;
}

// One side's three cells for one month: actual, forecast (what it was
// measured against on hover) and the difference. A month with no forecast
// shows a dash in each, as the Forecast page does, rather than one spanning
// cell, which would drop the row out of the shared zebra.
function SideCells({ kind, comparison, rule }) {
  if (!comparison) {
    return SPLIT.map((column) => (
      <td key={column} className={cn(amountClass, 'text-deep-violet-blue/45', rule)} title="No forecast for this month">
        —
      </td>
    ));
  }
  return (
    <>
      <td className={cn(amountClass, 'text-deep-violet-blue/75', rule)}>{formatUnits(comparison.actual)}</td>
      <td
        className={cn(amountClass, 'text-deep-violet-blue/75', rule)}
        title={`Measured against ${SOURCE_LABEL[kind][comparison.source]}`}
      >
        {formatUnits(comparison.forecast)}
      </td>
      <td className={cn(amountClass, 'font-medium', rule)}>
        <ChangeValue pct={comparison.percent} decimals={2} />
        <span className="ml-1.5 text-[10px] font-normal text-deep-violet-blue/50">{signedUnits(comparison.difference)} units</span>
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
    <div className="overflow-x-auto rounded-md border border-lavander">
      <table className="aire-table-rows w-full border-separate border-spacing-0 text-left text-xs text-deep-violet-blue">
        <thead>
          <tr>
            <th rowSpan={2} className={cn(headerClass, 'px-2.5 pb-1 align-bottom')}>
              Month
            </th>
            {SIDES.map((side) => (
              <th key={side.kind} colSpan={3} className={cn(headerClass, 'border-l px-2 py-1.5 text-center')}>
                {side.label}
              </th>
            ))}
          </tr>
          <tr>
            {SIDES.map((side) =>
              SPLIT.map((column) => (
                <th key={`${side.kind}-${column}`} className={splitHeaderClass}>
                  {column}
                </th>
              )),
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const rule = index < rows.length - 1 ? 'border-b border-lavander/70' : '';
            return (
              <tr key={row.month} className="h-10">
                <td className={cn('whitespace-nowrap px-2.5 py-2 align-middle font-medium', rule)}>
                  {formatMonth(row.month)}
                </td>
                {SIDES.map((side) => (
                  <SideCells key={side.kind} kind={side.kind} comparison={row[side.key]} rule={rule} />
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
