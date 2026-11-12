'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { lockBudget } from '@/app/services/budgetsApi';
import useBudgets from '@/hooks/useBudgets';
import { formatDateTime } from '@/lib/formatDate';

/**
 * Explicit whole-year lock, with all prior versions retained and visible.
 * @param {{ year: number, unsaved: number, loading: boolean, hasInitial: boolean, loadError?: string | null }} props
 */
export default function BudgetLockControl({ year, unsaved, loading, hasInitial, loadError }) {
  const budgets = useBudgets({ year });
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  async function lock() {
    setPending(true);
    setError(null);
    try {
      await lockBudget(year);
      budgets.refresh();
      setConfirming(false);
    } catch (err) { setError(err.message); }
    finally { setPending(false); }
  }
  return (
    <div className="space-y-2 rounded-md border border-lavander bg-cream p-3 text-xs text-deep-violet-blue">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p>Budget {year} · Initial Yearly Forecast with saved growth, blocks and promotion replacements.</p>
        <Button onClick={() => setConfirming(true)} disabled={loading || budgets.loading || Boolean(budgets.error || loadError) || unsaved > 0 || !hasInitial}>
          {budgets.data.history.length ? 'Lock new budget version' : 'Lock budget'}
        </Button>
      </div>
      <p>{unsaved ? 'Save or discard all drafts and edits before locking.' : 'Locks the whole year for every customer and SKU with an Initial forecast, regardless of chart filters.'}</p>
      {!hasInitial && !loading ? <p>No Initial forecast is available for {year} yet.</p> : null}
      <p className="text-deep-violet-blue/60">Initial can change until 31 December SGT. Each lock keeps its numbers; there is no automatic budget lock.</p>
      {budgets.data.history.length ? (
        <details>
          <summary className="cursor-pointer">Locked versions ({budgets.data.history.length})</summary>
          <ul className="mt-1 space-y-1">{budgets.data.history.map((item, index) => (
            <li key={item.snapshot_id}>Version {item.version}{index === 0 ? ' · shown on charts' : ''} · {formatDateTime(item.locked_at)} · {item.locked_by}</li>
          ))}</ul>
        </details>
      ) : null}
      {budgets.error || error ? <p role="alert">{error ?? budgets.error}</p> : null}
      {budgets.error ? <Button variant="outline" size="sm" onClick={budgets.refresh}>Retry budget status</Button> : null}
      <ConfirmDialog tone="default" open={confirming} title={`Lock budget ${year}?`}
        description="This saves a new frozen version for all customers and SKUs. Forecast and Inventory will show this version as Budget; earlier versions remain in history."
        confirmLabel="Lock budget" pendingLabel="Locking…" isPending={pending} onConfirm={lock} onCancel={() => setConfirming(false)}>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      </ConfirmDialog>
    </div>
  );
}
