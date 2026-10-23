'use client';

import { useEffect, useState } from 'react';

import {
  getNotifications,
  markNotificationsRead,
  notificationsStreamUrl,
} from '@/app/services/notificationsApi';

/**
 * The shared notification feed (see backend notification_service): the 50
 * newest, read and unread, newest first. A read notification stays in the
 * list (shown greyed out); `unreadCount` counts only the unread ones.
 *
 * Pushed, not polled: an EventSource on /api/notifications/stream gets a
 * `changed` event the moment any notification is added, read or deleted --
 * from this tab, another person's, the forecast script or the scheduled
 * BigQuery run -- and only then is the list re-fetched. The browser
 * reconnects the stream by itself if it drops, and the list is re-fetched on
 * every (re)connect to catch anything missed in between. `refresh` is for the
 * moment someone opens the bell.
 *
 * @returns {{ notifications: object[], unreadCount: number, markRead: (ids: number[]) => Promise<void>, refresh: () => Promise<void> }}
 */
export default function useNotifications() {
  const [notifications, setNotifications] = useState([]);

  async function refresh() {
    try {
      const list = await getNotifications({ limit: 50 });
      setNotifications(list);
    } catch {
      // Leave the last good list in place; the next change or refresh() call will retry.
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function loadNotifications() {
      try {
        const list = await getNotifications({ limit: 50 });
        if (!cancelled) setNotifications(list);
      } catch {
        // Leave the last good list in place; the next change will retry.
      }
    }

    // `open` fires on the first connect and on every automatic reconnect.
    const source = new EventSource(notificationsStreamUrl());
    source.addEventListener('open', loadNotifications);
    source.addEventListener('changed', loadNotifications);

    return () => {
      cancelled = true;
      source.close();
    };
  }, []);

  async function markRead(ids) {
    if (ids.length === 0) return;
    // Optimistic: greyed out immediately rather than waiting on the request's
    // round trip, which otherwise makes every "Mark as read" feel laggy.
    // Rolled back if the request turns out to have failed.
    const previous = notifications;
    const readAt = new Date().toISOString();
    setNotifications((current) =>
      current.map((n) => (ids.includes(n.notification_id) && !n.read_at ? { ...n, read_at: readAt } : n)),
    );
    try {
      await markNotificationsRead(ids);
    } catch {
      setNotifications(previous);
    }
  }

  const unreadCount = notifications.filter((n) => !n.read_at).length;
  return { notifications, unreadCount, markRead, refresh };
}
