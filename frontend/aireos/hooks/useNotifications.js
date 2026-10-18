'use client';

import { useEffect, useState } from 'react';

import { getNotifications, markNotificationsRead } from '@/app/services/notificationsApi';

export const NOTIFICATIONS_POLL_MS = 60_000;

/**
 * Polls the shared, unread-only notification feed (see backend
 * notification_service) while the app is open, so a low-stock or
 * forecast-pipeline alert shows up without anyone keeping a page open --
 * same pattern as useDataFreshness. Once read, a notification drops out of
 * this list entirely rather than staying with its read state shown. Pauses
 * while the tab is hidden; the next poll on return catches up.
 *
 * The background poll is a safety net so the unread badge appears by itself
 * within a minute either way; `refresh` is for the moment someone actually
 * opens the bell, so checking it never depends on the poll's timing or needs
 * a page reload to see something that was just created.
 *
 * @param {number} [pollMs]
 * @returns {{ notifications: object[], unreadCount: number, markRead: (ids: number[]) => Promise<void>, refresh: () => Promise<void> }}
 */
export default function useNotifications(pollMs = NOTIFICATIONS_POLL_MS) {
  const [notifications, setNotifications] = useState([]);

  async function refresh() {
    try {
      const list = await getNotifications({ unreadOnly: true, limit: 50 });
      setNotifications(list);
    } catch {
      // Leave the last good list in place; the next poll or refresh() call will retry.
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function checkNotifications() {
      if (document.visibilityState === 'hidden') return;
      try {
        const list = await getNotifications({ unreadOnly: true, limit: 50 });
        if (cancelled) return;
        setNotifications(list);
      } catch {
        // Leave the last good list in place; try again on the next poll.
      }
    }

    checkNotifications();
    const intervalId = setInterval(checkNotifications, pollMs);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [pollMs]);

  async function markRead(ids) {
    if (ids.length === 0) return;
    // Optimistic: removed immediately rather than waiting on the request's
    // round trip, which otherwise makes every "Mark as read" feel laggy.
    // Rolled back if the request turns out to have failed.
    const previous = notifications;
    setNotifications((current) => current.filter((n) => !ids.includes(n.notification_id)));
    try {
      await markNotificationsRead(ids);
    } catch {
      setNotifications(previous);
    }
  }

  return { notifications, unreadCount: notifications.length, markRead, refresh };
}
