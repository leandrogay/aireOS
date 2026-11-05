'use client';

import { Bell } from 'lucide-react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import useNotifications from '@/hooks/useNotifications';

import NotificationPanel from './NotificationPanel';

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

  function handleOpenChange(open) {
    if (open) refresh();
  }

  return (
    <Popover onOpenChange={handleOpenChange}>
      <PopoverTrigger
        data-notification-bell
        aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications'}
        className="relative flex size-9 shrink-0 items-center justify-center rounded-md text-deep-violet-blue/70 transition-colors hover:bg-lavander hover:text-deep-violet-blue"
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
          alignOffset: with align="end" a negative value slides the popup right, past the
          page card's edge into the empty margin; Base UI's collision shift keeps it on
          screen when the window is narrow, and the arrow stays on the bell. */}
      <PopoverContent
        align="end"
        alignOffset={-96}
        arrow
        arrowClassName="data-[side=bottom]:border-lavander"
        sideOffset={10}
        // fixed: placed against the viewport, so this tall popup never adds to
        // the page's scroll height (with the default "absolute" the page could
        // be scrolled past its end while the panel was open).
        positionMethod="fixed"
        className="w-[26rem] max-w-[90vw] gap-0 p-0 ring-lavander shadow-[0_2px_4px_rgb(15_30_74/0.1),0_12px_32px_rgb(15_30_74/0.08)]"
      >
        <NotificationPanel notifications={notifications} markRead={markRead} />
      </PopoverContent>
    </Popover>
  );
}
