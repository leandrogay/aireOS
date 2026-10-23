'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

import { cardClass } from '@/components/inventory/formStyles';
import { getPromoAnchorHistory, getPromoUpliftHistory } from '@/app/services/promoUpliftsApi';
import { anchorSourceLabel, changedByLabel, scopeLabel } from '@/app/utils/promoUpliftSettings';
import { formatPct, sourceLabel } from '@/app/utils/scenarioPromotions';
import { formatDateTime } from '@/lib/formatDate';

/**
 * Every saved version of one mechanic (all scopes) or one customer's
 * ordinary-month discount, newest first. Nothing is ever deleted, so this is
 * the full record of who changed what and when.
 *
 * @param {{ target: { kind: 'mechanic' | 'anchor', id: string | number, title: string }, onClose: () => void }} props
 */
export default function PromoHistoryPanel({ target, onClose }) {
  const [state, setState] = useState({ rows: [], loading: true, error: null });

  useEffect(() => {
    let cancelled = false;
    const load = target.kind === 'mechanic' ? getPromoUpliftHistory(target.id) : getPromoAnchorHistory(target.id);
    load
      .then((rows) => {
        if (!cancelled) setState({ rows, loading: false, error: null });
      })
      .catch((err) => {
        if (!cancelled) setState({ rows: [], loading: false, error: err.message });
      });
    return () => {
      cancelled = true;
    };
  }, [target.kind, target.id]);

  return (
    <section className={cardClass}>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-medium text-deep-violet-blue">History · {target.title}</h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close history"
          className="rounded p-1 text-deep-violet-blue/60 hover:bg-cream hover:text-deep-violet-blue"
        >
          <X className="size-4" />
        </button>
      </div>

      {state.loading ? <p className="text-sm text-deep-violet-blue/60">Loading history…</p> : null}
      {state.error ? (
        <p className="text-sm text-red-600" role="alert">
          {state.error}
        </p>
      ) : null}
      {!state.loading && !state.error && state.rows.length === 0 ? (
        <p className="text-sm text-deep-violet-blue/60">No versions saved yet.</p>
      ) : null}

      <ul className="divide-y divide-lavander text-sm text-deep-violet-blue">
        {state.rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-baseline justify-between gap-2 py-1.5">
            <span>
              {target.kind === 'mechanic' ? (
                <>
                  <b>{formatPct(row.uplift_pct)}</b> · {scopeLabel(row)} · {sourceLabel(row.source)}
                  {row.note ? <span className="text-deep-violet-blue/60"> · {row.note}</span> : null}
                </>
              ) : (
                <>
                  <b>{row.anchor_pct != null ? `${row.anchor_pct}%` : 'Use suggestion'}</b> ·{' '}
                  {anchorSourceLabel(row.source)}
                </>
              )}
              {target.kind === 'anchor' ? (row.is_current ? ' · current' : '') : row.superseded_at ? '' : ' · current'}
            </span>
            <span className="text-xs text-deep-violet-blue/60">
              {row.changed_at ? `${formatDateTime(row.changed_at)} · ` : ''}
              {changedByLabel(row.changed_by)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
