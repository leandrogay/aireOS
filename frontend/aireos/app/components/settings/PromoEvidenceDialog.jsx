'use client';

import { useEffect, useState } from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import InfoTooltip from '@/components/ui/InfoTooltip';
import { getPromoUpliftEvidence } from '@/app/services/promoUpliftsApi';
import { EVIDENCE_HINTS } from '@/app/utils/promoUpliftHints';
import { evidenceDetails, scopeLabel } from '@/app/utils/promoUpliftSettings';
import { formatDateTime } from '@/lib/formatDate';

/**
 * The measurement behind one uplift ("Evidence" in its "..." menu): what the
 * data said for this SKU and customer, the rule-based uplift it was blended
 * towards, the backtest check, and what the run did with it.
 *
 * @param {object} props
 * @param {object} props.row the setting row
 * @param {() => void} props.onClose
 */
export default function PromoEvidenceDialog({ row, onClose }) {
  const [state, setState] = useState({ result: null, loading: true, error: null });

  useEffect(() => {
    let cancelled = false;

    async function fetchEvidence() {
      try {
        const data = await getPromoUpliftEvidence(row.id);
        if (!cancelled) setState({ result: data.result, loading: false, error: null });
      } catch (err) {
        if (!cancelled) setState({ result: null, loading: false, error: err.message });
      }
    }

    fetchEvidence();
    return () => {
      cancelled = true;
    };
  }, [row.id]);

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Evidence: {row.mechanic_label}</DialogTitle>
          <DialogDescription>
            {scopeLabel(row)}
            {state.result ? ` · run of ${formatDateTime(state.result.run_finished_at)}` : ''}
          </DialogDescription>
        </DialogHeader>

        {state.loading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
        {state.error ? (
          <p className="text-sm text-red-700" role="alert">{state.error}</p>
        ) : null}
        {!state.loading && !state.error && !state.result ? (
          <p className="text-sm text-muted-foreground">
            No measurement yet for this uplift. All-customers uplifts are never measured; each customer and SKU gets
            its own measured uplift once there is evidence.
          </p>
        ) : null}

        {state.result ? (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg border border-border p-4">
            {evidenceDetails(state.result).map(([label, value]) => (
              <div key={label} className={label === 'Why' ? 'col-span-2' : undefined}>
                <dt className="flex items-center gap-1 text-xs text-muted-foreground">
                  {label}
                  {EVIDENCE_HINTS[label] ? (
                    <InfoTooltip label={`About ${label}`}>{EVIDENCE_HINTS[label]}</InfoTooltip>
                  ) : null}
                </dt>
                <dd className="mt-0.5 font-medium">{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
