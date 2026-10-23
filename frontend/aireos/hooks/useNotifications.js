'use client';

import { useEffect, useState } from 'react';

import {
  getNotifications,
  markNotificationsRead,
  notificationsStreamUrl,
} from '@/app/services/notificationsApi';

/**
 * The shared, unread-only notification feed (see backend notification_service).
 * Once read, a notification drops out of this list entirely rather than
 * staying with its read state shown.
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
      const list = await getNotifications({ unreadOnly: true, limit: 50 });
      setNotifications(list);
    } catch {
      // Leave the last good list in place; the next change or refresh() call will retry.
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function loadNotifications() {
      try {
        const list = await getNotifications({ unreadOnly: true, limit: 50 });
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
