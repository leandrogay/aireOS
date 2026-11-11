import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';

/**
 * A compact record view for phone screens; the full table stays on larger screens.
 * @param {{ title: import('react').ReactNode, subtitle?: import('react').ReactNode,
 *   badge?: import('react').ReactNode, actions?: import('react').ReactNode,
 *   fields?: Array<{ label: string, value: import('react').ReactNode }>,
 *   children?: import('react').ReactNode, className?: string }} props
 */
export default function MobileRecordCard({ title, subtitle, badge, actions, fields = [], children, className }) {
  return (
    <Card role="article" size="sm" className={cn('gap-0 aire-card p-3 ring-0', className)}>
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 className="min-w-0 break-words text-sm font-semibold text-deep-violet-blue">{title}</h3>
            {badge}
          </div>
          {subtitle && <p className="mt-0.5 break-words text-xs text-ink-soft">{subtitle}</p>}
        </div>
        {actions && <div className="-mr-1 -mt-1 shrink-0">{actions}</div>}
      </div>
      {fields.length > 0 && (
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-lavander/70 pt-3">
          {fields.map(({ label, value }) => (
            <div key={label} className="min-w-0">
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-ink-soft">{label}</dt>
              <dd className="mt-0.5 break-words text-xs text-deep-violet-blue">{value ?? '—'}</dd>
            </div>
          ))}
        </dl>
      )}
      {children}
    </Card>
  );
}
