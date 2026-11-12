import { cn } from '@/lib/utils';

// The outlined icon button every table card's header uses (Refresh, Expand /
// Collapse), on DataTable's and TableCardHeader's `actions` alike. Pass it as
// the Button's (or RefreshButton's) className.
export const TABLE_HEADER_BUTTON_CLASS = 'rounded-md border-deep-violet-blue/30 bg-white text-deep-violet-blue hover:bg-cream';

/**
 * Title, supporting information, and controls shared by table cards.
 * `detail` can be text or a loading skeleton, which renders as a div.
 * `actions` sit centred against the title and detail; style their icon
 * buttons with TABLE_HEADER_BUTTON_CLASS.
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
    <div className={cn('flex min-w-0 flex-wrap items-center justify-between gap-2', className)}>
      <div className="min-w-0">
        <h3 className="font-serif text-base text-deep-violet-blue">{title}</h3>
        {detail ? <div className="mt-0.5 text-xs text-deep-violet-blue/70" aria-live="polite">{detail}</div> : null}
      </div>
      {actions ? <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
