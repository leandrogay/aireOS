import { formatChangePct } from '@/app/utils/periodComparison';

/**
 * The "▲ +12.1% vs previous week" line at the foot of the trend charts'
 * tooltips, green up / red down. Renders nothing without a change.
 *
 * @param {{ pct: number | null | undefined, suffix: string }} props
 */
export default function TooltipChange({ pct, suffix }) {
  if (pct === null || pct === undefined) return null;
  const color = pct > 0 ? 'text-green-600' : pct < 0 ? 'text-red-600' : 'text-deep-violet-blue';
  return (
    <div className={`mt-0.5 border-t border-lavander pt-1 font-medium ${color}`}>
      {pct > 0 ? '▲ ' : pct < 0 ? '▼ ' : ''}
      {formatChangePct(pct)} {suffix}
    </div>
  );
}
