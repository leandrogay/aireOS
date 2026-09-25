// A tooltip row that keeps the series name. The shared ChartTooltipContent drops
// the name and colour marker whenever a `formatter` is passed, leaving a bare
// number, so the inventory charts pass this instead.

/**
 * @param {Record<string, { label: string }>} config the chart's series config, keyed by dataKey
 * @param {(value: number) => string} format how to print the value
 * @returns {(value: number, name: string, item: { color?: string }) => import('react').ReactNode}
 */
export function labelledTooltipRow(config, format) {
  return function TooltipRow(value, name, item) {
    return (
      <div className="flex w-full items-center justify-between gap-4">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: item.color }} />
          {config[name]?.label ?? name}
        </span>
        <span className="font-mono font-medium tabular-nums text-foreground">{format(value)}</span>
      </div>
    );
  };
}
