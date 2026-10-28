'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import StatusPill from '@/components/ui/StatusPill';
import TableGrid from '@/components/ui/TableGrid';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { getPromoAnchorHistory, getPromoRule, getPromoUpliftHistory } from '@/app/services/promoUpliftsApi';
import {
  HISTORY_ACTIONS,
  anchorHistoryAction,
  anchorSourceLabel,
  changedByLabel,
  mechanicKind,
  ruleExample,
  scopeLabel,
  upliftHistoryAction,
} from '@/app/utils/promoUpliftSettings';
import { retailerLabel } from '@/app/utils/retailerLabel';
import { formatPct, sourceLabel } from '@/app/utils/scenarioPromotions';
import { formatDateTime } from '@/lib/formatDate';

import {
  PROMO_ANCHOR_HISTORY_COLUMNS,
  PROMO_RULE_HISTORY_COLUMNS,
  PROMO_UPLIFT_HISTORY_COLUMNS,
} from './promoUpliftColumns';

function lastChanged(row) {
  return row.changed_at ? `${formatDateTime(row.changed_at)} · ${changedByLabel(row.changed_by)}` : changedByLabel(row.changed_by) || '—';
}

// The mechanic history endpoint returns every scope of a mechanic; one row's
// history is the versions with its own scope and target.
function sameTarget(version, row) {
  return (
    version.scope === row.scope &&
    (version.customer_id ?? null) === (row.customer_id ?? null) &&
    (version.sku_range ?? null) === (row.sku_range ?? null) &&
    (version.sku ?? null) === (row.sku ?? null)
  );
}

function mechanicFields(row, shownUplift) {
  return [
    ['Mechanic', row.mechanic_label],
    ['Type', mechanicKind(row) === 'voucher' ? 'Voucher' : 'Promotion'],
    ['Discount', row.effective_discount_pct != null ? `${row.effective_discount_pct}%` : '—'],
    ['Applies to', scopeLabel(row)],
    ['Uplift', formatPct(shownUplift)],
    ['Source', sourceLabel(row.source)],
    ['Status', row.archived_at ? 'Archived' : 'In use'],
    ['Last changed', lastChanged(row)],
  ];
}

function anchorFields(row) {
  return [
    ['Customer', retailerLabel(row.customer_name)],
    ['Ordinary-month discount', `${row.anchor_pct}%`],
    ['Source', anchorSourceLabel(row.source)],
    [
      'Suggested from data',
      row.suggested ? `${row.suggested.anchor_pct}% (median of ${row.suggested.months_used} months)` : 'No usable promotions yet',
    ],
    ['Last changed', lastChanged(row)],
  ];
}

function ruleFields(row) {
  return [
    ['Rate', `${row.uplift_per_point_pct}% per extra point of discount`],
    ['Example', `5 points deeper than normal → ${ruleExample(row.uplift_per_point_pct)}`],
    ['Default', `${row.default_uplift_per_point_pct}% per point`],
    ['Last changed', lastChanged(row)],
  ];
}

// A rule version is a reset when it went back to the default from something else.
function ruleHistoryAction(version, previous, defaultRate) {
  if (!previous) return 'created';
  return version.uplift_per_point_pct === defaultRate ? 'reset' : 'updated';
}

function loadVersions(kind, historyId) {
  if (kind === 'mechanic') return getPromoUpliftHistory(historyId);
  if (kind === 'rule') return getPromoRule().then((rule) => rule.history);
  return getPromoAnchorHistory(historyId);
}

function ActionPill({ action }) {
  const { label, tone } = HISTORY_ACTIONS[action];
  return <StatusPill tone={tone}>{label}</StatusPill>;
}

/**
 * The current value of one uplift row or one customer's ordinary-month
 * discount, and every saved version of it, newest first (History in the
 * row's "..." menu). Laid out like the SKU catalogue's details dialog.
 * Nothing is ever deleted, so this is the full record of who changed what.
 *
 * @param {object} props
 * @param {{ kind: 'mechanic', row: object, shownUplift: number } | { kind: 'anchor', row: object } | { kind: 'rule', row: object }} props.target
 *   for 'rule', `row` is `rule` from getPromoUpliftSettings
 * @param {(() => void) | null} props.onEdit opens Edit details; null when the row cannot be edited
 * @param {() => void} props.onClose
 */
export default function PromoHistoryDialog({ target, onEdit, onClose }) {
  const { kind, row } = target;
  const [state, setState] = useState({ versions: [], loading: true, error: null });
  const historyId = kind === 'mechanic' ? row.mechanic_key : kind === 'anchor' ? row.customer_id : 'rule';

  useEffect(() => {
    let cancelled = false;
    loadVersions(kind, historyId)
      .then((versions) => {
        if (!cancelled) setState({ versions, loading: false, error: null });
      })
      .catch((err) => {
        if (!cancelled) setState({ versions: [], loading: false, error: err.message });
      });
    return () => {
      cancelled = true;
    };
  }, [kind, historyId]);

  const isMechanic = kind === 'mechanic';
  const isRule = kind === 'rule';
  const versions = isMechanic ? state.versions.filter((version) => sameTarget(version, row)) : state.versions;
  const fields = isMechanic ? mechanicFields(row, target.shownUplift) : isRule ? ruleFields(row) : anchorFields(row);
  const actionFor = isMechanic
    ? upliftHistoryAction
    : isRule
      ? (version, previous) => ruleHistoryAction(version, previous, row.default_uplift_per_point_pct)
      : anchorHistoryAction;
  const title = isMechanic ? row.mechanic_label : isRule ? 'Rule for rule-based uplifts' : retailerLabel(row.customer_name);
  const columns = isMechanic ? PROMO_UPLIFT_HISTORY_COLUMNS : isRule ? PROMO_RULE_HISTORY_COLUMNS : PROMO_ANCHOR_HISTORY_COLUMNS;

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {isMechanic
              ? 'Current uplift and its recorded update history.'
              : isRule
                ? 'Current rate and its recorded update history.'
                : 'Current ordinary-month discount and its recorded update history.'}
          </DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg border border-border p-4">
          {fields.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="mt-0.5 font-medium">{value}</dd>
            </div>
          ))}
        </dl>

        <section>
          <h3 className="mb-2 font-medium">Update history</h3>
          {state.error ? (
            <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{state.error}</p>
          ) : (
            <TableGrid
              variant="nested"
              columns={columns}
              minWidth="42rem"
              isLoading={state.loading}
              skeletonRows={2}
              emptyState={!state.loading && versions.length === 0 ? 'No history has been recorded yet.' : null}
            >
              {versions.map((version, index) => (
                <tr key={version.id} className="h-11 border-b border-lavander/80 last:border-b-0">
                  <td className="px-4 py-2">
                    <ActionPill action={actionFor(version, versions[index + 1] ?? null)} />
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {version.changed_at ? formatDateTime(version.changed_at) : '—'}
                  </td>
                  {isMechanic ? (
                    <>
                      <td className="px-4 py-2 tabular-nums">{formatPct(version.uplift_pct)}</td>
                      <td className="px-4 py-2">{sourceLabel(version.source)}</td>
                      <td className="truncate px-4 py-2">{changedByLabel(version.changed_by)}</td>
                      <td className="truncate px-4 py-2 text-muted-foreground" title={version.note ?? undefined}>
                        {version.note ?? '—'}
                      </td>
                    </>
                  ) : isRule ? (
                    <>
                      <td className="px-4 py-2 tabular-nums">{version.uplift_per_point_pct}%</td>
                      <td className="px-4 py-2 tabular-nums">{ruleExample(version.uplift_per_point_pct)}</td>
                      <td className="truncate px-4 py-2">{changedByLabel(version.changed_by)}</td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-2 tabular-nums">
                        {version.anchor_pct != null ? `${version.anchor_pct}%` : 'Use suggested value'}
                      </td>
                      <td className="px-4 py-2">{anchorSourceLabel(version.source)}</td>
                      <td className="truncate px-4 py-2">{changedByLabel(version.changed_by)}</td>
                    </>
                  )}
                </tr>
              ))}
            </TableGrid>
          )}
        </section>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          {onEdit && <Button onClick={onEdit}>Edit details</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
