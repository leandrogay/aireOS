'use client';

import { Bell } from 'lucide-react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import useNotifications from '@/hooks/useNotifications';
import { cn } from '@/lib/utils';

import NotificationPanel from './NotificationPanel';

/**
 * Bell icon with an unread-count badge, opening the shared notification feed
 * (low-stock/stockout alerts, forecast pipeline success/failure -- see
 * backend notification_service). Shown in the sidebar whether it is
 * collapsed or not, since an alert matters regardless of which page is open.
 * Opening it always re-fetches first, so what's shown never depends on the
 * background poll's timing or needs a page reload to catch up. Nothing is
 * marked read just by opening the panel -- that is a deliberate action, per
 * notification or all at once (see NotificationPanel).
 *
 * @param {{ collapsed: boolean }} props
 */
export default function NotificationBell({ collapsed }) {
  const { notifications, unreadCount, markRead, refresh } = useNotifications();

  function handleOpenChange(open) {
    if (open) refresh();
  }

  return (
    <Popover onOpenChange={handleOpenChange}>
      <PopoverTrigger
        aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications'}
        className={cn(
          'relative flex size-8 items-center justify-center rounded-md text-deep-violet-blue/70 transition-colors hover:bg-lavander hover:text-deep-violet-blue',
          collapsed && 'mx-auto',
        )}
      >
        <Bell className="size-4" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-medium leading-none text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align={collapsed ? 'start' : 'end'} className="w-80 max-w-[90vw] p-2.5">
        <NotificationPanel notifications={notifications} markRead={markRead} />
      </PopoverContent>
    </Popover>
  );
}
