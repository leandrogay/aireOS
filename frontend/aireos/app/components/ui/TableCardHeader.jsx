import { cn } from '@/lib/utils';

/**
 * Title, supporting information, and controls shared by table cards.
 * `detail` can be text or a loading skeleton, which renders as a div.
 *
 * @param {{
 *   title: import('react').ReactNode,
 *   detail?: import('react').ReactNode,
 *   actions?: import('react').ReactNode,
 *   className?: string,
 * }} props
 */
export default function TableCardHeader({ title, detail, actions, className }) {
  return (
    <div className={cn('flex min-w-0 flex-wrap items-start justify-between gap-2', className)}>
      <div className="min-w-0">
        <h3 className="font-serif text-base text-deep-violet-blue">{title}</h3>
        {detail ? <div className="mt-0.5 text-xs text-ink-soft" aria-live="polite">{detail}</div> : null}
      </div>
      {actions ? <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
