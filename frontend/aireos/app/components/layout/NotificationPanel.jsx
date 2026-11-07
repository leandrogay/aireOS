'use client';

import { ChevronDown } from 'lucide-react';

import useExpandedRows from '@/hooks/useExpandedRows';
import { formatDateTime } from '@/lib/formatDate';
import { cn } from '@/lib/utils';
import { notificationHeading } from '@/app/utils/notificationText';

import NotificationDetails from './NotificationDetails';

// Each notification is a row that opens like the forecast page's promo
// dropdown (ForecastPromoPanel): the tag, time and title on the row, the
// details underneath once clicked. Several can be open at once.
// Rows stay white; only the row under the cursor is tinted lavender. Unread
// notifications get a bar down the left edge and a bold title, so the state
// is not shown by colour alone (WCAG 1.4.1).
// Muted text is deep-violet-blue/80: about 5.4:1 on white and 5:1 on the hover
// tint; /60 and /50 fall below the WCAG 1.4.3 minimum of 4.5:1. Read notifications
// are not faded with opacity for the same reason.
// wrap-anywhere: file and mapping names have no spaces, so they break to stay in the panel.
const MUTED_TEXT_CLASS = 'text-deep-violet-blue/80';

// Per tone (notificationHeading): the tag's fill and text, and the bar down
// the left edge of an unread row. Five tones cover all seven notification types
// (success / failure share one each across forecast and rollback). The tag has
// no border; its dot repeats the word, so the type never rests on colour alone.
// Tag colours are OKLCH with one lightness for every fill (0.95) and one for
// every text (0.42), only the hue changing, so no pill looks paler than another
// (Tailwind's amber-50 / red-50 / ... differ in lightness). Text on fill is
// about 7:1, above the WCAG 1.4.3 minimum.
const TONES = {
  warning: { tag: 'bg-[oklch(0.95_0.04_80)] text-[oklch(0.42_0.09_60)]', bar: 'bg-amber-500' },
  success: { tag: 'bg-[oklch(0.95_0.04_160)] text-[oklch(0.42_0.09_160)]', bar: 'bg-emerald-500' },
  danger: { tag: 'bg-[oklch(0.95_0.04_25)] text-[oklch(0.42_0.13_25)]', bar: 'bg-red-500' },
  info: { tag: 'bg-[oklch(0.95_0.04_280)] text-[oklch(0.42_0.09_280)]', bar: 'bg-violet' },
  // AI model outdated: blue, so it doesn't share a colour with the other alert types.
  model: { tag: 'bg-[oklch(0.95_0.04_235)] text-[oklch(0.42_0.09_235)]', bar: 'bg-sky-500' },
  muted: { tag: 'bg-[oklch(0.95_0_0)] text-[oklch(0.42_0_0)]', bar: 'bg-deep-violet-blue/40' },
};

function TypeTag({ tone, children }) {
  return (
    <span
      className={cn(
        // A faint drop shadow gives the borderless pill its edge.
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium shadow-[0_1px_2px_rgb(15_30_74/0.12)]',
        (TONES[tone] || TONES.muted).tag,
      )}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

/**
 * "Mark as read" / "Mark all as read": a small white, fully rounded pill with a
 * light violet border, cream on hover.
 * min-h-6: WCAG 2.5.8 asks for pointer targets of at least 24 x 24 CSS px.
 *
 * @param {{ onClick: () => void, children: import('react').ReactNode }} props
 */
function MarkReadButton({ onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-6 shrink-0 cursor-pointer items-center rounded-full border border-violet/30 bg-white px-2.5 text-[11px] font-medium text-deep-violet-blue transition hover:bg-cream"
    >
      {children}
    </button>
  );
}

/**
 * One notification: a row with its tag, when it was sent and its title, that
 * opens to show the details; plus its own "Mark as read" and then the arrow
 * at the right (siblings of the toggle, since a button can't sit inside
 * another button).
 *
 * @param {{ notification: { notification_id: number, notification_type: string, payload: object, created_at: string, read_at: string | null }, isOpen: boolean, onToggle: () => void, onMarkRead: () => void }} props
 */
function NotificationItem({ notification, isOpen, onToggle, onMarkRead }) {
  const { notification_id: id, notification_type: type, payload, created_at: createdAt, read_at: readAt } =
    notification;
  const { tag, tone, title } = notificationHeading(type, payload);
  const unread = !readAt;
  const detailsId = `notification-${id}-details`;

  return (
    // The whole notification tints on hover -- its row, its "Mark as read"
    // and its open details -- so it reads as one item.
    <li className="relative wrap-anywhere transition-colors hover:bg-lavander/40">
      {/* Unread rows get a bar in their type's colour down the left edge. */}
      {unread && (
        <span aria-hidden="true" className={cn('absolute inset-y-0 left-0 w-1', (TONES[tone] || TONES.muted).bar)} />
      )}
      {/* The row button spans the whole width, so the title below the tag line
          runs edge to edge with the same padding (px-3.5) on both sides.
          "Mark as read" and the arrow sit on the tag line only, laid over the
          button's top right (a button can't sit inside another button); the
          tag line keeps clear of them with right padding. */}
      <div className="relative">
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={detailsId}
          onClick={onToggle}
          className="block w-full px-3.5 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-deep-violet-blue"
        >
          <span
            className={cn(
              'flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1',
              unread ? 'pr-[8.5rem]' : 'pr-8',
            )}
          >
            <TypeTag tone={tone}>{tag}</TypeTag>
            <span className={cn('text-[11px]', MUTED_TEXT_CLASS)}>{formatDateTime(createdAt)}</span>
          </span>
          <span
            className={cn(
              // mt-[11px]: room between the title and "Mark as read" above it
              // (same on read rows, so every row has one rhythm).
              'mt-[11px] block text-[13px] leading-snug text-deep-violet-blue',
              unread ? 'font-semibold' : 'font-medium',
            )}
          >
            {/* Unread is shown by the bar and the bold title, not by colour alone (WCAG 1.4.1). */}
            {unread && <span className="sr-only">Unread: </span>}
            {title}
          </span>
        </button>
        <div className="absolute top-2.5 right-2.5 flex items-center gap-1">
          {unread && <MarkReadButton onClick={onMarkRead}>Mark as read</MarkReadButton>}
          {/* The arrow is at the far right, after "Mark as read", so it is in
              the same place on every row. It opens the same details as the row
              button; that button is the one keyboards and screen readers use,
              so this copy is skipped by both. */}
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            onClick={onToggle}
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-deep-violet-blue/70 hover:text-deep-violet-blue"
          >
            <ChevronDown className={cn('size-4 transition', isOpen && 'rotate-180')} />
          </button>
        </div>
      </div>
      {isOpen && (
        // White, so the details card stays a white card even while the row
        // above it is tinted on hover.
        <div id={detailsId} className="mx-3.5 mb-3 rounded-lg border border-violet/30 bg-white px-3 py-2.5">
          <NotificationDetails type={type} payload={payload} />
        </div>
      )}
    </li>
  );
}

/**
 * The bell's dropdown contents: the shared feed, unread first and then read,
 * each newest first. An unread notification has a coloured bar on its left
 * edge, a bold title and its own "Mark as read"; once read it stays in the list in regular weight. "Mark
 * all as read" shows while anything is unread.
 *
 * @param {{ notifications: object[], markRead: (ids: number[]) => void }} props
 */
export default function NotificationPanel({ notifications, markRead }) {
  const { isExpanded, toggle } = useExpandedRows();

  if (notifications.length === 0) {
    return <p className="px-3 py-3 text-xs text-deep-violet-blue/75">No notifications yet.</p>;
  }

  const unread = notifications.filter((n) => !n.read_at);
  const read = notifications.filter((n) => n.read_at);
  const unreadIds = unread.map((n) => n.notification_id);
  // Unread first, so what still needs attention is never buried under read
  // items; each group keeps the feed's newest-first order.
  const ordered = [...unread, ...read];

  // The popup has no padding of its own (see NotificationBell): the header and
  // the rows pad themselves with px-3, so hover tints run edge to edge.
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-lavander px-3 py-2.5">
        <div>
          <p className="font-serif text-base leading-tight text-deep-violet-blue">Notifications</p>
          <p className={cn('mt-0.5 text-[11px]', MUTED_TEXT_CLASS)}>
            {unreadIds.length > 0 ? `${unreadIds.length} unread` : 'All caught up'}
          </p>
        </div>
        {unreadIds.length > 0 && (
          <MarkReadButton onClick={() => markRead(unreadIds)}>Mark all as read</MarkReadButton>
        )}
      </div>
      {/* rounded-b-lg clips the last row's hover tint to the popup's corners.
          Thin violet scrollbar (standard scrollbar-width/-color, no arrow
          buttons) instead of the default grey one. */}
      <ul className="max-h-[65vh] divide-y divide-lavander overflow-y-auto rounded-b-lg [scrollbar-color:var(--aire-violet)_transparent] [scrollbar-width:thin]">
        {ordered.map((notification) => (
          <NotificationItem
            key={notification.notification_id}
            notification={notification}
            isOpen={isExpanded(notification.notification_id)}
            onToggle={() => toggle(notification.notification_id)}
            onMarkRead={() => markRead([notification.notification_id])}
          />
        ))}
      </ul>
    </div>
  );
}
