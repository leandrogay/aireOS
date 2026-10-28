'use client';

import { useState } from 'react';
import { RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import InfoTooltip from '@/components/ui/InfoTooltip';
import { cardClass, secondaryButtonClass } from '@/components/inventory/formStyles';
import usePromoMeasurement from '@/hooks/usePromoMeasurement';
import {
  keepPromoTypedValue,
  runPromoMeasurement,
  applyPromoMeasuredValue,
} from '@/app/services/promoUpliftsApi';
import { measurementStatusLine, noteTitle } from '@/app/utils/promoUpliftSettings';
import { formatPct } from '@/app/utils/scenarioPromotions';
import { formatDateTime } from '@/lib/formatDate';
import { PROMO_HINTS } from '@/app/utils/promoUpliftHints';

const RUN_MESSAGES = {
  succeeded: 'Measured',
  succeeded_with_warnings: 'Measured, with warnings',
  skipped_unchanged: 'Nothing has changed since the last measurement',
};

/**
 * Measured uplifts on the Promotion uplift settings page: when they were last
 * measured and the next scheduled run (daily, 04:00 Singapore time), a stale
 * warning, the Re-measure button, and the notes where a measured uplift
 * differs from one somebody typed ([Use measured] / [Keep mine]).
 *
 * @param {object} props
 * @param {number} props.refreshKey bumped by the page after any write
 * @param {boolean} props.readOnly no buttons
 * @param {(key: string) => string} props.labelForKey mechanic key -> its label
 * @param {() => void} props.onChanged refetch the page after a write here
 * @param {(tone: string, message: string) => void} props.notify
 */
export default function PromoMeasurementPanel({ refreshKey, readOnly, labelForKey, onChanged, notify }) {
  const { status, notes, loading, error } = usePromoMeasurement({ refreshKey });
  const [busy, setBusy] = useState(null);

  async function remeasure() {
    setBusy('measure');
    try {
      const run = await runPromoMeasurement();
      const counts = run.counts ?? {};
      const detail = run.status === 'skipped_unchanged' ? '' : `: ${counts.applied ?? 0} values updated, ${counts.notes_opened ?? 0} new notes`;
      notify('success', `${RUN_MESSAGES[run.status] ?? run.status}${detail}`);
      onChanged();
    } catch (err) {
      notify('error', err.message);
    } finally {
      setBusy(null);
    }
  }

  async function decide(note, action) {
    setBusy(note.id);
    try {
      if (action === 'use') await applyPromoMeasuredValue(note.id);
      else await keepPromoTypedValue(note.id);
      notify('success', action === 'use' ? 'Measured uplift now in use' : 'Your uplift is kept');
      onChanged();
    } catch (err) {
      notify('error', err.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className={cardClass}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-1 text-sm font-medium text-deep-violet-blue">
            Measured from sales data
            <InfoTooltip label="How uplifts are measured" className="w-80">{PROMO_HINTS.measured}</InfoTooltip>
          </h2>
          <p className="mt-0.5 text-xs text-deep-violet-blue/60">
            {loading && !status ? 'Loading…' : measurementStatusLine(status, formatDateTime)}
          </p>
        </div>
        {readOnly ? null : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={remeasure}
            disabled={busy !== null}
            className={secondaryButtonClass}
          >
            <RefreshCw aria-hidden="true" className={busy === 'measure' ? 'animate-spin' : undefined} />
            {busy === 'measure' ? 'Measuring…' : 'Re-measure'}
          </Button>
        )}
      </div>

      {error ? (
        <p className="mt-2 text-xs text-red-700" role="alert">
          Could not load the measurement status: {error}
        </p>
      ) : null}

      {status?.stale ? (
        <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status">
          {status.last_success
            ? `No successful measurement for over ${status.stale_days} days. The daily job may have stopped; check it in Google Cloud (Cloud Run Jobs › aireos-promo-measure).`
            : 'Uplifts have not been measured yet. They stay rule-based until the first run.'}
        </p>
      ) : null}

      {status?.last_run?.status === 'failed' ? (
        <p className="mt-2 text-xs text-red-700" role="alert">
          The last run failed and changed nothing: {status.last_run.error}
        </p>
      ) : null}


      {notes.length ? (
        <div className="mt-3 grid gap-2">
          <h3 className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-deep-violet-blue/60">
            {notes.length} measured uplift{notes.length === 1 ? '' : 's'} differ from uplifts typed by hand
            <InfoTooltip label="About these notes" className="w-80">{PROMO_HINTS.notes}</InfoTooltip>
          </h3>
          {notes.map((note) => (
            <div
              key={note.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-lavander bg-cream/60 px-3 py-2 text-sm"
            >
              <div>
                <p className="font-medium text-deep-violet-blue">{noteTitle(note, labelForKey)}</p>
                <p className="text-xs text-deep-violet-blue/70">
                  {note.note_type === 'anchor'
                    ? `Suggested from data: ${note.measured_value}% (${note.evidence_months} months). Your value: ${note.user_value}%.`
                    : `Measured uplift is now ${formatPct(note.measured_value)} (${note.evidence_months} months). Your uplift: ${formatPct(note.user_value)}.`}
                </p>
              </div>
              {readOnly ? null : (
                <div className="flex gap-2">
                  <Button type="button" size="sm" disabled={busy !== null} onClick={() => decide(note, 'use')}>
                    {note.note_type === 'anchor' ? 'Use suggested' : 'Use measured'}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy !== null}
                    onClick={() => decide(note, 'keep')}
                    className={secondaryButtonClass}
                  >
                    Keep mine
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
