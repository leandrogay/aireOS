import { cn } from '@/lib/utils';

/** Title, supporting information, and controls shared by table cards. */
export default function TableCardHeader({ title, detail, actions, className }) {
  return (
    <div className={cn('flex min-w-0 flex-wrap items-start justify-between gap-2', className)}>
      <div className="min-w-0">
        <h3 className="font-serif text-base text-deep-violet-blue">{title}</h3>
        {detail ? <p className="mt-0.5 text-xs text-deep-violet-blue/70" aria-live="polite">{detail}</p> : null}
      </div>
      {actions ? <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
