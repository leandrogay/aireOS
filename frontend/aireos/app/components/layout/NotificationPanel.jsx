'use client';

import { formatDate, formatDateTime } from '@/lib/formatDate';
import { retailerLabel } from '@/app/utils/retailerLabel';
import { cn } from '@/lib/utils';

// Every notification this panel ever receives is unread (the feed is fetched
// unread-only -- see useNotifications), so one card style covers all of them.
const CARD_CLASS = 'rounded-lg border border-violet bg-lavander/40 px-3 py-2.5 text-xs';

function Field({ label, value }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-deep-violet-blue/60">{label}</span>
      <span className="text-right font-medium text-deep-violet-blue">{value}</span>
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

function forecastTitle(payload, success) {
  const date = formatDate(payload.updated_at?.slice(0, 10));
  return success ? `[SUCCESS] Forecast Pipeline Completed – ${date}` : `[FAILURE] Forecast Pipeline Failed – ${date}`;
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
  return (
    <>
      <p className="text-deep-violet-blue/80">
        {success
          ? 'The sales forecasting pipeline has completed successfully, and the latest forecast is ready for review.'
          : 'The sales forecasting pipeline encountered an error and did not complete.'}
      </p>
      <div className="mt-2 space-y-1">
        <Field
          label="Forecast period"
          value={payload.period_start ? `${payload.period_start} – ${payload.period_end}` : '—'}
        />
        <Field
          label="Customers processed"
          value={
            payload.customers.length
              ? `${payload.customers.length}: ${payload.customers.map(retailerLabel).join(', ')}`
              : '0'
          }
        />
        <Field
          label="SKUs forecasted"
          value={payload.skus.length ? `${payload.skus.length}: ${payload.skus.join(', ')}` : '0'}
        />
        <Field label="Last updated" value={formatDateTime(payload.updated_at)} />
        <Field label="Started by" value={payload.source === 'scheduled' ? 'Scheduled run' : 'Forecast script'} />
      </div>
      {!success && (
        <div className="mt-1">
          <span className="text-deep-violet-blue/60">Errors / Warnings</span>
          <p className="mt-0.5 text-deep-violet-blue">{payload.errors?.length ? payload.errors.join('; ') : 'None'}</p>
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
          ? 'An approved file mapping was changed. Every future file with these columns will use the new version.'
          : 'A new file mapping was approved. Every future file with these columns will be loaded with it.'}
      </p>
      <div className="mt-2 space-y-1">
        <Field label="Mapping" value={payload.name} />
        <Field label="Vendor" value={payload.vendor} />
        <Field label="Waiting files loaded" value={payload.uploads_processed} />
        {payload.uploads_failed > 0 && <Field label="Waiting files that failed" value={payload.uploads_failed} />}
      </div>
    </>
  );
}

const TITLES = {
  low_stock: lowStockTitle,
  forecast_success: (payload) => forecastTitle(payload, true),
  forecast_failure: (payload) => forecastTitle(payload, false),
  mapping_uploaded: (payload) => `[MAPPING] ${payload.amended ? 'Mapping updated' : 'New mapping approved'} – ${payload.name}`,
};

const MARK_READ_BUTTON_CLASS =
  'shrink-0 rounded-md border border-violet/40 bg-white px-2 py-0.5 text-[11px] font-medium text-deep-violet-blue transition hover:bg-cream';

/**
 * One notification's rendered wording, by notification_type, with when it
 * was sent and its own "Mark as read" (marking it removes it from the list
 * entirely -- see useNotifications, which fetches unread-only). The backend
 * stores structured `payload` fields, not text, so the exact copy lives here
 * and can change without a migration.
 *
 * @param {{ notification: { notification_id: number, notification_type: string, payload: object, created_at: string }, onMarkRead: () => void }} props
 */
function NotificationCard({ notification, onMarkRead }) {
  const { notification_type: type, payload, created_at: createdAt } = notification;
  const title = TITLES[type] ? TITLES[type](payload) : 'Notification';

  return (
    <div className={CARD_CLASS}>
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 font-serif text-sm text-deep-violet-blue">{title}</p>
        <button type="button" onClick={onMarkRead} className={cn(MARK_READ_BUTTON_CLASS, 'shrink-0')}>
          Mark as read
        </button>
      </div>
      {type === 'low_stock' && <LowStockDetails payload={payload} />}
      {type === 'forecast_success' && <ForecastDetails payload={payload} success />}
      {type === 'forecast_failure' && <ForecastDetails payload={payload} success={false} />}
      {type === 'mapping_uploaded' && <MappingDetails payload={payload} />}
      <p className="mt-2 text-right text-[10px] text-deep-violet-blue/50">{formatDateTime(createdAt)}</p>
    </div>
  );
}

/**
 * The bell's dropdown contents: every unread notification from the shared
 * feed, newest first, each with when it was sent and its own "Mark as read",
 * plus a "Mark all as read" above the list. A notification disappears from
 * here as soon as it's read -- this only ever shows unread ones.
 *
 * @param {{ notifications: object[], markRead: (ids: number[]) => void }} props
 */
export default function NotificationPanel({ notifications, markRead }) {
  if (notifications.length === 0) {
    return <p className="px-1 py-2 text-xs text-deep-violet-blue/70">No unread notifications.</p>;
  }

  const allIds = notifications.map((n) => n.notification_id);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-end px-0.5">
        <button type="button" onClick={() => markRead(allIds)} className={MARK_READ_BUTTON_CLASS}>
          Mark all as read
        </button>
      </div>
      <div className="flex max-h-96 flex-col gap-1.5 overflow-y-auto">
        {notifications.map((notification) => (
          <NotificationCard
            key={notification.notification_id}
            notification={notification}
            onMarkRead={() => markRead([notification.notification_id])}
          />
        ))}
      </div>
    </div>
  );
}
