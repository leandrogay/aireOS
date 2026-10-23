import { request } from '@/app/services/promotionsApi';

/**
 * GET /api/notifications
 *
 * The shared notification feed (no per-user accounts exist, so there is only
 * one list), newest first.
 *
 * @param {{ unreadOnly?: boolean, limit?: number }} [options]
 * @returns {Promise<Array<{ notification_id: number, notification_type: string, payload: object, created_at: string, read_at: string | null }>>}
 */
export async function getNotifications({ unreadOnly = false, limit = 50 } = {}) {
  const params = new URLSearchParams();
  if (unreadOnly) params.set('unread_only', 'true');
  params.set('limit', String(limit));
  return request(`/api/notifications?${params.toString()}`);
}

/**
 * GET /api/notifications/unread-count
 *
 * @returns {Promise<{ unread_count: number }>}
 */
export async function getUnreadNotificationCount() {
  return request('/api/notifications/unread-count');
}

/**
 * POST /api/notifications/mark-read
 *
 * @param {number[]} notificationIds
 * @returns {Promise<{ marked_read: number }>}
 */
export async function markNotificationsRead(notificationIds) {
  return request('/api/notifications/mark-read', {
    method: 'POST',
    body: { notification_ids: notificationIds },
  });
}
