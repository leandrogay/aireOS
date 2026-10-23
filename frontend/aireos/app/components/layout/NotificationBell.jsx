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
      <PopoverContent align="end" className="w-80 max-w-[90vw] p-2.5">
        <NotificationPanel notifications={notifications} markRead={markRead} />
      </PopoverContent>
    </Popover>
  );
}
