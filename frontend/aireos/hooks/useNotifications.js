'use client';

import { useEffect, useRef, useState } from 'react';

import {
  getNotifications,
  markNotificationsRead,
  notificationsStreamUrl,
} from '@/app/services/notificationsApi';

/**
 * Fetches the list, but only hands it back if nothing has superseded it since
 * it started: a newer fetch (answers can arrive out of order) or a Mark as
 * read (an answer started before the click still says "unread"). Anything
 * marked read whose request is still in flight is kept read, so a list that
 * lands in between can't flash it back to unread. Returns null if superseded.
 */
async function fetchNewest(latestFetch, pendingRead) {
  const request = ++latestFetch.current;
  const list = await getNotifications({ limit: 50 });
  if (request !== latestFetch.current) return null;
  if (pendingRead.current.size === 0) return list;
  const readAt = new Date().toISOString();
  return list.map((n) => (pendingRead.current.has(n.notification_id) && !n.read_at ? { ...n, read_at: readAt } : n));
}

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
  const latestFetch = useRef(0);
  const pendingRead = useRef(new Set());

  async function refresh() {
    try {
      const list = await fetchNewest(latestFetch, pendingRead);
      if (list) setNotifications(list);
    } catch {
      // Leave the last good list in place; the next change or refresh() call will retry.
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function loadNotifications() {
      try {
        const list = await fetchNewest(latestFetch, pendingRead);
        if (list && !cancelled) setNotifications(list);
      } catch {
        // Leave the last good list in place; the next change will retry.
      }
    }

    // `open` fires on the first connect and on every automatic reconnect.
    // withCredentials sends the session cookie cross-origin; without it the
    // protected stream answers 401 when the API is on another origin.
    const source = new EventSource(notificationsStreamUrl(), { withCredentials: true });
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
    ids.forEach((id) => pendingRead.current.add(id));
    latestFetch.current += 1;
    setNotifications((current) =>
      current.map((n) => (ids.includes(n.notification_id) && !n.read_at ? { ...n, read_at: readAt } : n)),
    );
    try {
      await markNotificationsRead(ids);
    } catch {
      setNotifications(previous);
    } finally {
      ids.forEach((id) => pendingRead.current.delete(id));
    }
  }

  const unreadCount = notifications.filter((n) => !n.read_at).length;
  return { notifications, unreadCount, markRead, refresh };
}
