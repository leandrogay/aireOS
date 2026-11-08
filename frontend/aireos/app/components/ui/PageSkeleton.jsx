import { cn } from '@/lib/utils';

/**
 * Wrapper for a whole-page (or whole-section) loading placeholder, built
 * from CardSkeleton, BarChartSkeleton / LineChartSkeleton and the first-load
 * state of real components such as DataTable. ScenarioBuilderSkeleton is the
 * model.
 *
 * It announces one busy status with `label` and hides everything inside
 * from assistive tech and the keyboard (`inert`), so the pieces' own loading
 * labels aren't read out one by one and a reused real control (DataTable's
 * sort headers, say) can't take focus while it is only a placeholder.
 *
 * `className` is the layout of the children (spacing, grid), so it can match
 * the loaded page's own wrapper exactly.
 *
 * @param {{
 *   label?: string,
 *   className?: string,
 *   children: import('react').ReactNode,
 * }} props
 */
export default function PageSkeleton({ label = 'Loading…', className, children }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" inert className={cn(className)}>
        {children}
      </div>
    </div>
  );
}
