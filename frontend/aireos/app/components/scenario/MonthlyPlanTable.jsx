'use client';

import { ChevronDown } from 'lucide-react';

import { cn } from '@/lib/utils';
import InfoTooltip from '@/components/ui/InfoTooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { HEADER_RULE } from '@/components/forecast/ForecastYearTotals';
import { formatMonthLabel } from '@/app/utils/forecastView';

const headerCell = cn(
  'border-b bg-cream px-2 py-1.5 text-right align-bottom text-[10px] font-bold uppercase leading-tight tracking-wide text-deep-violet-blue',
  HEADER_RULE
);

function units(value) {
  return Math.round(value).toLocaleString('en-US');
}

function signed(value, format) {
  return `${value < 0 ? '−' : '+'}${format(Math.abs(value))}`;
}

function percent(share) {
  return share == null ? '—' : `${share < 0 ? '−' : '+'}${Math.abs(share * 100).toFixed(1)}%`;
}

function Header({ label, hint, align = 'right' }) {
  return (
    <th className={cn(headerCell, align === 'left' && 'text-left')}>
      <span className={cn('inline-flex items-end gap-1', align === 'right' && 'justify-end')}>
        {label}
        {hint ? <InfoTooltip label={`About ${label}`}>{hint}</InfoTooltip> : null}
      </span>
    </th>
  );
}

// The blocks adding to a month: one opens straight away; several open a
// short list to pick from.
function BlockLinks({ items, onOpen }) {
  const chip =
    'mt-1 inline-flex max-w-[7.5rem] items-center gap-1 rounded-full bg-scenario-soft px-2 py-px text-[10px] font-semibold text-scenario-ink hover:bg-scenario/15';
  if (items.length === 1) {
    return (
      <button type="button" onClick={() => onOpen(items[0].itemId)} className={chip} title={`Edit ${items[0].name}`}>
        <span className="truncate">{items[0].name}</span>
      </button>
    );
  }
  return (
    <Popover>
      <PopoverTrigger className={chip}>
        {items.length} blocks
        <ChevronDown className="size-3" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 bg-white p-1.5">
        <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-deep-violet-blue/50">
          Open in the panel
        </p>
        {items.map((item) => (
          <button
            key={item.itemId}
            type="button"
            onClick={() => onOpen(item.itemId)}
            className="block w-full truncate rounded px-2 py-1 text-left text-xs text-deep-violet-blue hover:bg-cream"
          >
            {item.name}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

/**
 * The Scenario builder's monthly plan for the filters' scope: one row per
 * forecast month with Last year actual, Model forecast, Building blocks and
 * Adjusted forecast in units, and the variance against last
 * year. Months a switched-on block changes are shaded, and a block's name
 * opens it in the panel (new blocks are added there). All numbers come from
 * scenarioPlan.buildPlanRows.
 *
 * @param {{
 *   rows: ReturnType<typeof import('@/app/utils/scenarioPlan').buildPlanRows>,
 *   lastYearLoading: boolean,
 *   onOpenItem: (itemId: string) => void,
 *   scope: string,
 * }} props
 */
export default function MonthlyPlanTable({ rows, lastYearLoading, onOpenItem, scope }) {
  if (!rows.length) {
    return (
      <p className="rounded-md border border-lavander bg-white px-3 py-3 text-xs text-deep-violet-blue/60">
        No forecast months in this period. Pick a period that reaches into the forecast to plan building blocks.
      </p>
    );
  }

  return (
    <section aria-label="Monthly plan" className="space-y-1.5">
      <p className="text-[11px] text-deep-violet-blue/60">
        <span className="font-semibold text-deep-violet-blue">{scope}</span> · Units.
        Shaded months have a switched-on building block.
      </p>
      <div className="overflow-x-auto rounded-md border border-lavander">
        <table className="w-full border-separate border-spacing-0 text-xs text-deep-violet-blue">
          <thead>
            <tr>
              <Header label="Month" align="left" />
              <Header label="Last year actual" hint="Sell-out in the same month a year earlier." />
              <Header label="Model forecast" hint="The Current forecast line, before any building blocks." />
              <Header label="Building blocks" hint="What the switched-on building blocks add this month." />
              <Header
                label="Adjusted forecast"
                hint="Model forecast plus building blocks: the Simulated line on the chart."
              />
              <Header
                label="vs last year"
                hint="Adjusted forecast minus last year's actual."
              />
              <Header label="%" hint="The change against last year as a share of last year's actual." />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const marked = row.items.length > 0;
              const rule = index < rows.length - 1 ? 'border-b border-lavander/70' : '';
              const cell = cn('whitespace-nowrap px-2 py-1.5 text-right align-top tabular-nums', rule);
              const label = formatMonthLabel(row.month_year);
              const change = row.variance;
              const tone = (value) => (value < 0 ? 'text-red-700' : 'text-emerald-700');
              return (
                <tr key={row.month_year} className={marked ? 'bg-scenario-soft/50' : 'bg-white'}>
                  <td
                    className={cn(
                      'whitespace-nowrap px-2 py-1.5 text-left align-top font-medium',
                      rule,
                      marked ? 'border-l-[3px] border-l-scenario' : 'border-l-[3px] border-l-transparent'
                    )}
                  >
                    {label}
                  </td>
                  <td className={cell}>
                    {row.lastYear ? (
                      <span className="font-semibold">{units(row.lastYear.units)}</span>
                    ) : (
                      <span className="text-deep-violet-blue/45">{lastYearLoading ? '…' : 'No sales'}</span>
                    )}
                  </td>
                  <td className={cell}>
                    <span className="font-semibold">{units(row.model.units)}</span>
                  </td>
                  <td className={cell}>
                    {marked ? (
                      <>
                        <span className="block font-semibold text-scenario-ink">{signed(row.blocks.units, units)}</span>
                        <BlockLinks items={row.items} onOpen={onOpenItem} />
                      </>
                    ) : (
                      <span className="text-deep-violet-blue/45">—</span>
                    )}
                  </td>
                  <td className={cell}>
                    <span className={cn('font-semibold', marked && 'text-scenario-ink')}>{units(row.adjusted.units)}</span>
                  </td>
                  {change ? (
                    <>
                      <td className={cell}>
                        <span className={cn('font-semibold', tone(change.units))}>{signed(change.units, units)}</span>
                      </td>
                      <td className={cell}>
                        <span className={cn('font-semibold', tone(change.units))}>{percent(change.unitsPct)}</span>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className={cell}>
                        <span className="text-deep-violet-blue/45">{lastYearLoading ? '…' : '—'}</span>
                      </td>
                      <td className={cell}>
                        <span className="text-deep-violet-blue/45">{lastYearLoading ? '…' : '—'}</span>
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
