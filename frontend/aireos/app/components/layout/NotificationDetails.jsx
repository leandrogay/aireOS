import { formatDate, formatDateTime } from '@/lib/formatDate';
import { forecastErrorLines, isRefreshFailure, startedByLabel } from '@/app/utils/forecastNotificationText';
import { daysLeftValue, lowStockItemText, modelFeatureLabel } from '@/app/utils/notificationText';
import { retailerLabel } from '@/app/utils/retailerLabel';
import { cn } from '@/lib/utils';

// The opened part of a notification, laid out like the forecast page's promo
// dropdown (ForecastPromoPanel): one short line saying what happened, then
// label / value rows with short sentence-case labels, so each row stays on
// one line. Lists are chips. Every value the old always-open panel showed is
// still here; only the wording around them is shorter.
// Labels are deep-violet-blue/80, not the promo panel's /45: /60 and below
// fall under the WCAG 1.4.3 minimum of 4.5:1 on the tinted rows.
const LABEL_CLASS = 'text-[11px] text-deep-violet-blue/80';
const VALUE_CLASS = 'min-w-0 text-xs font-medium text-deep-violet-blue';
const ROW_CLASS = 'grid grid-cols-[6.5rem_1fr] items-baseline gap-2';

function Summary({ children }) {
  return <p className="text-xs leading-normal text-deep-violet-blue/80">{children}</p>;
}

function Field({ label, value }) {
  return (
    <div className={ROW_CLASS}>
      <span className={LABEL_CLASS}>{label}</span>
      <span className={VALUE_CLASS}>{value}</span>
    </div>
  );
}

// More names than this and the chips stack in one column, one per line,
// so a long list (a forecast's SKUs) lines up instead of wrapping raggedly.
const CHIP_COLUMN_AFTER = 5;
// One line per chip: a narrow panel (a third of a 1024px page) would
// otherwise wrap a name inside its pill. A name too long for the panel ends
// in "…" and is shown in full on hover (title).
const CHIP_CLASS =
  'max-w-full truncate whitespace-nowrap rounded-full border border-lavander bg-white px-2 py-0.5 text-[10px] font-medium text-deep-violet-blue';

// A count plus one chip per name (customers, SKUs), like the promo panel's SKU
// chips, beside their label. Up to CHIP_COLUMN_AFTER sit in a row, as wide as
// their text; more stack one per line, each still as wide as its text.
function ChipField({ label, names }) {
  const asColumn = names.length > CHIP_COLUMN_AFTER;
  return (
    <div className={ROW_CLASS}>
      <span className={LABEL_CLASS}>{label}</span>
      {names.length ? (
        <ul className={cn('flex min-w-0 gap-1', asColumn ? 'flex-col items-start' : 'flex-wrap')}>
          {names.map((name) => (
            <li key={name} title={name} className={CHIP_CLASS}>
              {name}
            </li>
          ))}
        </ul>
      ) : (
        <span className={VALUE_CLASS}>None</span>
      )}
    </div>
  );
}

function filesText(count, noun = 'files') {
  return `${count} ${count === 1 ? noun.replace(/s$/, '') : noun}`;
}

function ErrorsField({ errors }) {
  return <Field label="Errors" value={errors?.length ? errors.join('; ') : 'None'} />;
}

// 10px between fields, so each one (a value, or a wrapped set of chips)
// reads as its own group; the summary above sits a little further off (12px).
function Fields({ children }) {
  return <div className="space-y-2.5">{children}</div>;
}

function LowStockDetails({ payload }) {
  // A consolidated alert (5+ SKUs in one batch) lists each briefly instead of
  // repeating the full single-SKU detail block nine times over.
  if (payload.items) {
    return (
      <>
        <Summary>Critical stock levels on these products. Please review and take action.</Summary>
        <ul className="divide-y divide-lavander overflow-hidden rounded-lg border border-lavander bg-white">
          {payload.items.map((item) => (
            <li key={item.sku} className="px-2.5 py-1.5 text-xs text-deep-violet-blue">
              {lowStockItemText(item)}
            </li>
          ))}
        </ul>
      </>
    );
  }

  const daysLeft = daysLeftValue(payload.doh_remaining);
  return (
    <>
      <Summary>Critical stock level on this product. Please review and take action.</Summary>
      <Fields>
        <Field label="Customer" value={retailerLabel(payload.customer_name)} />
        <Field label="Current stock" value={`${payload.current_stock} units`} />
        <Field label="Days left" value={`${daysLeft === null ? 'Unknown' : `${daysLeft} days`} (threshold ${payload.doh_threshold})`} />
        <Field label="Last updated" value={formatDate(payload.last_update)} />
      </Fields>
    </>
  );
}

// The cases, Started by and error lines come from forecastNotificationText
// (backend forecast_notifications payload: stage, reason, errors, source).
function forecastSummary(payload, success) {
  if (success) return 'The latest forecast is ready to review on the dashboard.';
  if (isRefreshFailure(payload, success)) {
    return "The forecast refresh couldn't start, so the forecast wasn't updated after the latest changes.";
  }
  return 'The forecasting pipeline hit an error and did not complete.';
}

function ForecastDetails({ payload, success }) {
  // Every producer sends these arrays, but one hand-inserted row without them
  // must not crash the whole page the bell sits on.
  const customers = (payload.customers ?? []).map(retailerLabel);
  const skus = payload.skus ?? [];
  // A refresh that never started (backend stage "refresh") has no forecast to
  // describe, so the period / customers / SKUs rows would only read "—" and "0".
  const neverStarted = isRefreshFailure(payload, success);
  const errorLines = forecastErrorLines(payload);
  return (
    <>
      <Summary>{forecastSummary(payload, success)}</Summary>
      <Fields>
        {!neverStarted && (
          <>
            <Field
              label="Period"
              value={payload.period_start ? `${payload.period_start} – ${payload.period_end}` : '—'}
            />
            <ChipField label={`Customers (${customers.length})`} names={customers} />
            <ChipField label={`SKUs (${skus.length})`} names={skus} />
          </>
        )}
        <Field label="Last updated" value={formatDateTime(payload.updated_at)} />
        <Field label="Started by" value={startedByLabel(payload.source)} />
        {!success && payload.reason && <Field label="Reason" value={payload.reason} />}
        {/* Older failures have no reason, only errors, so they still show "None"
            when empty; newer ones list errors only when they add to the reason. */}
        {!success && (!payload.reason || errorLines.length > 0) && <ErrorsField errors={errorLines} />}
      </Fields>
    </>
  );
}

function MappingDetails({ payload }) {
  return (
    <>
      <Summary>
        {payload.amended
          ? 'Future files with these columns will use the new version.'
          : 'Future files with these columns will be read with it.'}
      </Summary>
      <Fields>
        <Field label="Nomenclature" value={payload.name} />
        <Field label="Vendor" value={payload.vendor} />
        {/* Approvals since loading became its own step say what waits to be
            loaded (backend confirm_mapping); older ones said what they loaded. */}
        {payload.uploads_waiting !== undefined ? (
          <>
            <Field label="Waiting to load" value={filesText(payload.uploads_waiting)} />
            {payload.uploads_outdated > 0 && <Field label="To reload" value={filesText(payload.uploads_outdated)} />}
          </>
        ) : (
          <>
            <Field label="Loaded" value={filesText(payload.uploads_processed, 'waiting files')} />
            {payload.uploads_failed > 0 && (
              <Field label="Failed" value={filesText(payload.uploads_failed, 'waiting files')} />
            )}
          </>
        )}
      </Fields>
    </>
  );
}

// Written by backend ingestion_service.rollback_upload once a rollback has
// committed, or when it failed (one transaction, so nothing was changed then).
function RollbackDetails({ payload, success }) {
  return (
    <>
      <Summary>
        {success
          ? 'The sales figures it loaded were removed and the values it replaced restored.'
          : 'The rollback did not complete. No sales data was changed.'}
      </Summary>
      <Fields>
        <Field label="File" value={payload.source_file || '—'} />
        <Field label={success ? 'Rolled back by' : 'Requested by'} value={payload.rolled_back_by || '—'} />
        <Field label="Reason" value={payload.reason || '—'} />
        {success && (
          <Field
            label="Rows"
            value={`${payload.rows_restored ?? 0} restored · ${payload.rows_removed ?? 0} removed`}
          />
        )}
        {!success && <ErrorsField errors={payload.errors} />}
      </Fields>
    </>
  );
}

// The AI model a feature uses is being retired by Google (or already has
// been). The payload contract is listed with modelHeading in
// utils/notificationText.js. The model names come from backend config.py
// (MAPPING_MODEL / GEMINI_ASSISTANT_MODEL), so the fix is a settings change.
function ModelDetails({ payload }) {
  const feature = modelFeatureLabel(payload.feature);
  const retired = payload.status === 'retired';
  const date = payload.retires_on ? formatDate(payload.retires_on) : null;
  return (
    <>
      <Summary>
        {retired
          ? `The model ${feature} uses has been retired, so ${feature} won't work until it is switched to a newer model.`
          : `Google is retiring the model ${feature} uses${date ? ` on ${date}` : ''}. Switch to a newer model before then so it keeps working.`}
      </Summary>
      <Fields>
        <Field label="Feature" value={feature} />
        <Field label="Current model" value={payload.current_model || '—'} />
        {date && <Field label={retired ? 'Retired on' : 'Retires on'} value={date} />}
        <Field label="Suggested model" value={payload.suggested_model || 'Check Google’s current models'} />
        <Field
          label="Setting"
          value={<span className="font-mono text-[11px]">{payload.setting || '—'}</span>}
        />
        <Field label="How to change" value="Update the setting in the backend config, then redeploy." />
      </Fields>
    </>
  );
}

/**
 * The details of one notification, shown when its row is opened, by
 * notification_type.
 *
 * @param {{ type: string, payload: object }} props
 */
export default function NotificationDetails({ type, payload }) {
  return (
    <div className="space-y-3">
      {type === 'low_stock' && <LowStockDetails payload={payload} />}
      {type === 'forecast_success' && <ForecastDetails payload={payload} success />}
      {type === 'forecast_failure' && <ForecastDetails payload={payload} success={false} />}
      {type === 'mapping_uploaded' && <MappingDetails payload={payload} />}
      {type === 'rollback_success' && <RollbackDetails payload={payload} success />}
      {type === 'rollback_failure' && <RollbackDetails payload={payload} success={false} />}
      {type === 'model_outdated' && <ModelDetails payload={payload} />}
    </div>
  );
}
