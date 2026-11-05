'use client';

import { formatDate, formatDateTime } from '@/lib/formatDate';
import {
  forecastErrorLines,
  forecastIntro,
  forecastTitle,
  isRefreshFailure,
  startedByLabel,
} from '@/app/utils/forecastNotificationText';
import { retailerLabel } from '@/app/utils/retailerLabel';
import { cn } from '@/lib/utils';

// Notifications are separated by a divider plus space, not boxes:
// - inside one notification the gaps are 4px (lines) and 8px (title block → fields);
// - between notifications there is 24px (12px padding either side of the divider),
//   3x the largest inner gap so each one reads as its own group, and 2x the 12px
//   body text (the WCAG 1.4.12 paragraph spacing benchmark).
// Unread notifications are tinted lavender, with a bold title so the state is
// not shown by colour alone (WCAG 1.4.1).
// Muted text is deep-violet-blue/80: about 5.4:1 on white and 5:1 on the unread
// tint; /60 and /50 fall below the WCAG 1.4.3 minimum of 4.5:1. Read notifications
// are not faded with opacity for the same reason.
// wrap-anywhere: file and mapping names have no spaces, so they break to stay in the panel.
const ITEM_CLASS = 'px-3 py-3 text-xs leading-normal wrap-anywhere';
const UNREAD_ITEM_CLASS = 'bg-lavander/50';
const MUTED_TEXT_CLASS = 'text-deep-violet-blue/80';

function Field({ label, value }) {
  return (
    <div className="flex justify-between gap-3">
      <span className={cn('max-w-[60%] shrink-0', MUTED_TEXT_CLASS)}>{label}</span>
      <span className="min-w-0 text-right font-medium text-deep-violet-blue">{value}</span>
    </div>
  );
}

function lowStockItem(item) {
  return `${item.product_name} (${retailerLabel(item.customer_name)}) — ${item.doh_remaining} day${item.doh_remaining === 1 ? '' : 's'} left`;
}

function lowStockTitle(payload) {
  return payload.items
    ? `[STOCK ALERT] Low stock detected for ${payload.count} SKUs`
    : `[STOCK ALERT] Low stock detected for ${payload.product_name}`;
}

function forecastNotificationTitle(payload, success) {
  return forecastTitle(payload, success, formatDate(payload.updated_at?.slice(0, 10)));
}

function LowStockDetails({ payload }) {
  // A consolidated alert (5+ SKUs in one batch) lists each briefly instead of
  // repeating the full single-SKU detail block nine times over.
  if (payload.items) {
    return (
      <>
        <p className="text-deep-violet-blue/80">
          The inventory monitoring system has detected a critical stock level for the following products. Please
          review the details and take the necessary action.
        </p>
        <ul className="mt-2 list-disc space-y-0.5 pl-4 text-deep-violet-blue">
          {payload.items.map((item) => (
            <li key={item.sku}>{lowStockItem(item)}</li>
          ))}
        </ul>
      </>
    );
  }

  return (
    <>
      <p className="text-deep-violet-blue/80">
        The inventory monitoring system has detected a critical stock level for the following product. Please
        review the details and take the necessary action.
      </p>
      <div className="mt-2 space-y-1">
        <Field label="Customer / Retailer" value={retailerLabel(payload.customer_name)} />
        <Field label="Current stock" value={`${payload.current_stock} units`} />
        <Field label="DOH threshold" value={`${payload.doh_threshold} days`} />
        <Field label="Estimated days of stock remaining" value={`${payload.doh_remaining} days`} />
        <Field label="Last inventory update" value={formatDate(payload.last_update)} />
      </div>
    </>
  );
}

function ForecastDetails({ payload, success }) {
  // Every producer sends these arrays, but one hand-inserted row without them
  // must not crash the whole page the bell sits on.
  const customers = payload.customers ?? [];
  const skus = payload.skus ?? [];
  // A refresh that never started (backend stage "refresh") has no forecast to
  // describe, so the period / customers / SKUs rows would only read "—" and "0".
  const neverStarted = isRefreshFailure(payload, success);
  const errorLines = forecastErrorLines(payload);
  return (
    <>
      <p className={MUTED_TEXT_CLASS}>{forecastIntro(payload, success)}</p>
      <div className="mt-2 space-y-1">
        {!neverStarted && (
          <>
            <Field
              label="Forecast period"
              value={payload.period_start ? `${payload.period_start} – ${payload.period_end}` : '—'}
            />
            <Field
              label="Customers processed"
              value={
                customers.length
                  ? `${customers.length}: ${customers.map(retailerLabel).join(', ')}`
                  : '0'
              }
            />
            <Field
              label="SKUs forecasted"
              value={skus.length ? `${skus.length}: ${skus.join(', ')}` : '0'}
            />
          </>
        )}
        <Field label="Last updated" value={formatDateTime(payload.updated_at)} />
        <Field label="Started by" value={startedByLabel(payload.source)} />
      </div>
      {!success && payload.reason && (
        <div className="mt-1">
          <span className={MUTED_TEXT_CLASS}>Reason</span>
          <p className="mt-0.5 text-deep-violet-blue">{payload.reason}</p>
        </div>
      )}
      {/* Older failures have no reason, only errors, so they still show "None"
          when empty; newer ones list errors only when they add to the reason. */}
      {!success && (!payload.reason || errorLines.length > 0) && (
        <div className="mt-1">
          <span className={MUTED_TEXT_CLASS}>Errors / Warnings</span>
          <p className="mt-0.5 text-deep-violet-blue">{errorLines.length ? errorLines.join('; ') : 'None'}</p>
        </div>
      )}
      {success && (
        <p className="mt-2 text-deep-violet-blue/80">
          You can now access the dashboard to review the latest forecast results and recommended actions.
        </p>
      )}
    </>
  );
}

function MappingDetails({ payload }) {
  return (
    <>
      <p className="text-deep-violet-blue/80">
        {payload.amended
          ? 'An approved file nomenclature was changed. Every future file with these columns will use the new version.'
          : 'A new file nomenclature was approved. Every future file with these columns will be read with it.'}
      </p>
      <div className="mt-2 space-y-1">
        <Field label="Nomenclature" value={payload.name} />
        <Field label="Vendor" value={payload.vendor} />
        {/* Approvals since loading became its own step say what waits to be
            loaded (backend confirm_mapping); older ones said what they loaded. */}
        {payload.uploads_waiting !== undefined ? (
          <>
            <Field label="Files waiting to load" value={payload.uploads_waiting} />
            {payload.uploads_outdated > 0 && <Field label="Files to reload" value={payload.uploads_outdated} />}
          </>
        ) : (
          <>
            <Field label="Waiting files loaded" value={payload.uploads_processed} />
            {payload.uploads_failed > 0 && <Field label="Waiting files that failed" value={payload.uploads_failed} />}
          </>
        )}
      </div>
    </>
  );
}

// Written by backend ingestion_service.rollback_upload once a rollback has
// committed, or when it failed (one transaction, so nothing was changed then).
function RollbackDetails({ payload, success }) {
  return (
    <>
      <p className="text-deep-violet-blue/80">
        {success
          ? 'An upload was rolled back. The sales figures it loaded were removed, and the values it had replaced were restored.'
          : 'An attempt to roll back an upload did not complete. No sales data was changed.'}
      </p>
      <div className="mt-2 space-y-1">
        <Field label="File" value={payload.source_file || '—'} />
        <Field label={success ? 'Rolled back by' : 'Requested by'} value={payload.rolled_back_by || '—'} />
        <Field label="Reason" value={payload.reason || '—'} />
        {success && (
          <>
            <Field label="Rows restored" value={payload.rows_restored ?? 0} />
            <Field label="Rows removed" value={payload.rows_removed ?? 0} />
          </>
        )}
      </div>
      {!success && (
        <div className="mt-1">
          <span className={MUTED_TEXT_CLASS}>Errors / Warnings</span>
          <p className="mt-0.5 text-deep-violet-blue">{payload.errors?.length ? payload.errors.join('; ') : 'None'}</p>
        </div>
      )}
    </>
  );
}

const TITLES = {
  low_stock: lowStockTitle,
  forecast_success: (payload) => forecastNotificationTitle(payload, true),
  forecast_failure: (payload) => forecastNotificationTitle(payload, false),
  mapping_uploaded: (payload) => `[NOMENCLATURE] ${payload.amended ? 'Nomenclature updated' : 'New nomenclature approved'} – ${payload.name}`,
  rollback_success: () => `[SUCCESS] Upload Rolled Back`,
  rollback_failure: () => `[FAILURE] Upload Rollback Failed`,
};

// min-h-6: WCAG 2.5.8 asks for pointer targets of at least 24 x 24 CSS px.
const MARK_READ_BUTTON_CLASS =
  'inline-flex min-h-6 shrink-0 items-center rounded-md border border-violet/40 bg-white px-2 text-[11px] font-medium text-deep-violet-blue transition hover:bg-cream';

/**
 * One notification's rendered wording, by notification_type, with when it
 * was sent (kept beside the title, not across the panel) and its own "Mark as
 * read". The backend stores structured `payload` fields, not text, so the exact
 * copy lives here and can change without a migration.
 *
 * @param {{ notification: { notification_id: number, notification_type: string, payload: object, created_at: string, read_at: string | null }, onMarkRead: () => void }} props
 */
function NotificationItem({ notification, onMarkRead }) {
  const { notification_type: type, payload, created_at: createdAt, read_at: readAt } = notification;
  const title = TITLES[type] ? TITLES[type](payload) : 'Notification';
  const unread = !readAt;

  return (
    <li className={cn(ITEM_CLASS, unread && UNREAD_ITEM_CLASS)}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className={cn('font-serif text-sm text-deep-violet-blue', unread && 'font-semibold')}>
            {/* Unread is shown by the tint and the bold title, not by colour alone (WCAG 1.4.1). */}
            {unread && <span className="sr-only">Unread: </span>}
            {title}
          </p>
          <p className={cn('mt-1 text-[11px]', MUTED_TEXT_CLASS)}>{formatDateTime(createdAt)}</p>
        </div>
        {unread && (
          <button type="button" onClick={onMarkRead} className={MARK_READ_BUTTON_CLASS}>
            Mark as read
          </button>
        )}
      </div>
      <div className="mt-2">
        {type === 'low_stock' && <LowStockDetails payload={payload} />}
        {type === 'forecast_success' && <ForecastDetails payload={payload} success />}
        {type === 'forecast_failure' && <ForecastDetails payload={payload} success={false} />}
        {type === 'mapping_uploaded' && <MappingDetails payload={payload} />}
        {type === 'rollback_success' && <RollbackDetails payload={payload} success />}
        {type === 'rollback_failure' && <RollbackDetails payload={payload} success={false} />}
      </div>
    </li>
  );
}

/**
 * The bell's dropdown contents: the shared feed, unread first and then read,
 * each newest first. An unread notification has a tint, a bold title and its
 * own "Mark as read"; once read it stays in the list in regular weight. "Mark
 * all as read" shows while anything is unread.
 *
 * @param {{ notifications: object[], markRead: (ids: number[]) => void }} props
 */
export default function NotificationPanel({ notifications, markRead }) {
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
  // the rows pad themselves with px-3, so unread tints run edge to edge.
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between border-b border-lavander px-3 py-2.5">
        <p className="font-serif text-sm text-deep-violet-blue">Notifications</p>
        {unreadIds.length > 0 && (
          <button type="button" onClick={() => markRead(unreadIds)} className={MARK_READ_BUTTON_CLASS}>
            Mark all as read
          </button>
        )}
      </div>
      {/* A divider between notifications; see the spacing note at the top.
          rounded-b-lg clips the last row's tint to the popup's corners.
          Thin violet scrollbar (standard scrollbar-width/-color, no arrow
          buttons) instead of the default grey one. */}
      <ul className="max-h-[65vh] divide-y divide-lavander overflow-y-auto rounded-b-lg [scrollbar-color:var(--aire-violet)_transparent] [scrollbar-width:thin]">
        {ordered.map((notification) => (
          <NotificationItem
            key={notification.notification_id}
            notification={notification}
            onMarkRead={() => markRead([notification.notification_id])}
          />
        ))}
      </ul>
    </div>
  );
}
