'use client';

import { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import useNotifications from '@/hooks/useNotifications';

import { POPUP_SHADOW_CLASS } from '@/components/ui/popupShadow';
import { cn } from '@/lib/utils';

import NotificationPanel from './NotificationPanel';

// The panel is as wide as the dashboard's right-hand column (app/dashboard/page.js:
// `lg:grid-cols-3` with `gap-1`), so it lines up with that card's edges, and keeps
// that width on every page. The popup is portalled out of the page, so CSS can't
// take a fraction of the content column; it is measured from PageLayout's heading
// row ([data-page-heading], as wide as the content) when the bell opens and
// whenever the window is resized while it is open. The row is found with
// closest(), not parentElement: the bell sits in a small wrapper of its own.
const PAGE_COLUMNS = 3;
const PAGE_COLUMN_GAP_PX = 4;
// Below Tailwind's `lg`, the dashboard stacks into one column; the panel then
// falls back to a fixed width instead of the whole page.
const WIDE_LAYOUT_QUERY = '(min-width: 64rem)';
const NARROW_PANEL_WIDTH = '23rem';

function columnWidth(headingRow) {
  if (!headingRow || !window.matchMedia(WIDE_LAYOUT_QUERY).matches) return NARROW_PANEL_WIDTH;
  const rowWidth = headingRow.getBoundingClientRect().width;
  return `${(rowWidth - PAGE_COLUMN_GAP_PX * (PAGE_COLUMNS - 1)) / PAGE_COLUMNS}px`;
}

/**
 * Bell icon with an unread-count badge, opening the shared notification feed
 * (low stock, forecast pipeline success/failure, approved mappings -- see
 * backend notification_service). Sits at the top right of every page, in
 * PageLayout's heading row. The list is pushed (see useNotifications); opening
 * the bell also re-fetches, as a backstop. Nothing is marked read just by
 * opening the panel -- that is a deliberate action, per notification or all at
 * once (see NotificationPanel).
 */
export default function NotificationBell() {
  const { notifications, unreadCount, markRead, refresh } = useNotifications();
  const triggerRef = useRef(null);
  const [panelWidth, setPanelWidth] = useState(NARROW_PANEL_WIDTH);
  const [open, setOpen] = useState(false);

  function measure() {
    setPanelWidth(columnWidth(triggerRef.current?.closest('[data-page-heading]')));
  }

  function handleOpenChange(nextOpen) {
    setOpen(nextOpen);
    if (!nextOpen) return;
    measure();
    refresh();
  }

  // Keep the panel the column's width if the window is resized while it is open.
  useEffect(() => {
    if (!open) return undefined;
    function handleResize() {
      setPanelWidth(columnWidth(triggerRef.current?.closest('[data-page-heading]')));
    }
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [open]);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        ref={triggerRef}
        data-notification-bell
        aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications'}
        className="relative flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md text-deep-violet-blue/70 transition-colors hover:bg-lavander hover:text-deep-violet-blue"
      >
        <Bell className="size-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-medium leading-none text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </PopoverTrigger>
      {/* Two stacked shadows (tight edge + soft lift) tinted with deep violet blue
          (#0F1E4A) rather than black, so the popup floats above the page. Set
          here, not in ui/popover, so the other dropdowns keep their look.
          align="end" with no offset: the bell ends the heading row (PageLayout), whose
          right edge is the page content's, so the popup's right edge lines up with the
          cards below instead of hanging past them. */}
      <PopoverContent
        align="end"
        arrow
        // Same colour and width as the popup's outline (ring-violet/40 below),
        // so the tip reads as part of the panel's edge.
        arrowClassName="text-violet/40"
        sideOffset={10}
        // fixed: placed against the viewport, so this tall popup never adds to
        // the page's scroll height (with the default "absolute" the page could
        // be scrolled past its end while the panel was open).
        positionMethod="fixed"
        // Width measured on open (see columnWidth); a style, not a class,
        // because it is computed.
        style={{ width: panelWidth }}
        className={cn('max-w-[90vw] gap-0 p-0 ring-violet/40', POPUP_SHADOW_CLASS)}
      >
        <NotificationPanel notifications={notifications} markRead={markRead} />
      </PopoverContent>
    </Popover>
  );
}
