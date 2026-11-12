import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { glassSurfaceClass } from '@/components/ui/surfaceStyles';
import TableCardHeader from '@/components/ui/TableCardHeader';
import { cn } from '@/lib/utils';

/**
 * The glass card a page chart sits in, the chart counterpart of TableCard.
 * The header is optional: give a `title` (with `detail` under it, text or
 * scope tags) for a titled card, or only `actions` for a card whose top row is
 * its controls. The header is TableCardHeader, so chart and table cards share
 * one title style. Draw the chart itself in a ChartFrame.
 *
 * overflow-visible: a tooltip near the edge may hang over the card.
 *
 * @param {{
 *   title?: import('react').ReactNode,
 *   detail?: import('react').ReactNode,
 *   actions?: import('react').ReactNode,
 *   label?: string,
 *   className?: string,
 *   children: import('react').ReactNode,
 * }} props `label` names the card for screen readers when it has no title.
 */
export default function ChartCard({ title, detail, actions, label, className, children }) {
  return (
    <Card
      role="region"
      aria-label={label ?? (typeof title === 'string' ? title : undefined)}
      className={cn(glassSurfaceClass, 'min-w-0 overflow-visible text-deep-violet-blue', className)}
    >
      {title ? (
        <CardHeader className="pb-1">
          <TableCardHeader title={title} detail={detail} actions={actions} />
        </CardHeader>
      ) : actions ? (
        // No title: the controls alone, on the right, where a titled card has them.
        <CardHeader className="pb-1">
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">{actions}</div>
        </CardHeader>
      ) : null}
      <CardContent className="min-w-0">{children}</CardContent>
    </Card>
  );
}
