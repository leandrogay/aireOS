'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import StatusPill from '@/components/ui/StatusPill';
import { checkRowClass, hintClass, inputClass, labelClass } from '@/components/ui/formStyles';
import BudgetStartDialog from '@/components/scenario/BudgetStartDialog';
import { deleteBudgetVersion, lockBudget, setOfficialBudget } from '@/app/services/budgetsApi';
import { MAX_COMPARED_VERSIONS, budgetVersionLabel } from '@/app/utils/budgetPlanning';
import useBudgets from '@/hooks/useBudgets';
import { formatDateTime } from '@/lib/formatDate';

function units(value) {
  return Math.round(Number(value) || 0).toLocaleString('en-US');
}

/**
 * A year's budget versions: lock the entries as a new named version, start
 * the entries over (BudgetStartDialog), compare versions on the chart and
 * pick the official one -- the Budget line on Forecast and Inventory, which
 * a new lock changes only when it is made official.
 *
 * @param {{
 *   year: number, unsaved: number, loading: boolean, hasInitial: boolean, loadError?: string | null,
 *   entryCount: number,
 *   compared: { version: number, name: string | null }[],
 *   onComparedChange: (compared: { version: number, name: string | null }[]) => void,
 *   compareError?: string | null,
 *   onRestarted?: () => void,
 * }} props
 */
export default function BudgetLockControl({ year, unsaved, loading, hasInitial, loadError, entryCount, compared, onComparedChange, compareError, onRestarted }) {
  const budgets = useBudgets({ year });
  const history = budgets.data.history;
  const official = history.find((item) => item.is_official);
  const [locking, setLocking] = useState(false);
  const [starting, setStarting] = useState(false);
  const [name, setName] = useState('');
  const [makeOfficial, setMakeOfficial] = useState(true);
  const [pending, setPending] = useState(false);
  const [officialPending, setOfficialPending] = useState(null);
  const [error, setError] = useState(null);
  // The version waiting on the delete confirmation.
  const [deleting, setDeleting] = useState(null);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const blocked = loading || budgets.loading || Boolean(budgets.error || loadError) || unsaved > 0;

  async function lock() {
    setPending(true);
    setError(null);
    try {
      // The year's first version is official whatever the box says.
      await lockBudget({ year, name: name.trim(), makeOfficial: makeOfficial || !history.length });
      budgets.refresh();
      setLocking(false);
      setName('');
      setMakeOfficial(true);
    } catch (err) { setError(err.message); }
    finally { setPending(false); }
  }

  async function makeVersionOfficial(item) {
    setOfficialPending(item.version);
    setError(null);
    try {
      await setOfficialBudget(year, item.version);
      budgets.refresh();
    } catch (err) { setError(`Couldn't make ${budgetVersionLabel(item)} official: ${err.message}`); }
    finally { setOfficialPending(null); }
  }

  // Deleting only hides the version (its units stay on record), so it also
  // leaves the chart's comparison.
  async function deleteVersion() {
    setDeletePending(true);
    setDeleteError(null);
    try {
      await deleteBudgetVersion(year, deleting.version);
      onComparedChange(compared.filter((entry) => entry.version !== deleting.version));
      setDeleting(null);
      budgets.refresh();
    } catch (err) { setDeleteError(err.message); }
    finally { setDeletePending(false); }
  }

  function toggleCompared(item) {
    onComparedChange(compared.some((entry) => entry.version === item.version)
      ? compared.filter((entry) => entry.version !== item.version)
      : [...compared, { version: item.version, name: item.name }]);
  }

  return (
    <div className="space-y-2 rounded-md border border-lavander bg-cream p-3 text-xs text-deep-violet-blue">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p>Budget {year} · Initial Yearly Forecast with saved growth, blocks and promotion replacements.</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setStarting(true)} disabled={blocked}>Start from…</Button>
          <Button onClick={() => setLocking(true)} disabled={blocked || !hasInitial}>
            {history.length ? 'Lock new version' : 'Lock budget'}
          </Button>
        </div>
      </div>
      <p>{unsaved ? 'Save or discard all drafts and edits before locking or starting over.' : 'Locks the whole year for every customer and SKU with an Initial forecast, regardless of chart filters.'}</p>
      {!hasInitial && !loading ? <p>No Initial forecast is available for {year} yet.</p> : null}
      <p className="text-deep-violet-blue/60">
        Initial can change until 31 December SGT. The official version is the Budget line on Forecast and Inventory;
        {official ? ` now ${budgetVersionLabel(official)}.` : ' the first lock becomes it.'} Compare versions here before choosing.
      </p>
      {history.length ? (
        <details>
          <summary className="cursor-pointer">Locked versions ({history.length})</summary>
          <ul className="mt-1 divide-y divide-lavander">{history.map((item) => {
            const isCompared = compared.some((entry) => entry.version === item.version);
            return (
              <li key={item.snapshot_id} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5">
                <span className="font-medium">{budgetVersionLabel(item)}</span>
                {item.is_official ? <StatusPill tone="success">Official</StatusPill> : null}
                <span className="text-deep-violet-blue/60">{units(item.total_units)} units · {formatDateTime(item.locked_at)} · {item.locked_by}</span>
                <span className="ml-auto flex gap-1">
                  <Button size="sm" variant="outline" aria-pressed={isCompared} onClick={() => toggleCompared(item)}
                    disabled={!isCompared && compared.length >= MAX_COMPARED_VERSIONS}>
                    {isCompared ? 'Hide from chart' : 'Compare on chart'}
                  </Button>
                  {item.is_official ? null : (
                    <Button size="sm" variant="outline" onClick={() => makeVersionOfficial(item)} disabled={officialPending != null}>
                      {officialPending === item.version ? 'Making official…' : 'Make official'}
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => setDeleting(item)} disabled={item.is_official}
                    aria-label={`Delete ${budgetVersionLabel(item)}`}>
                    Delete
                  </Button>
                </span>
              </li>
            );
          })}</ul>
          {compared.length >= MAX_COMPARED_VERSIONS ? <p className={hintClass}>Up to {MAX_COMPARED_VERSIONS} versions at once.</p> : null}
          <p className={hintClass}>The official version can&apos;t be deleted; make another version official first.</p>
        </details>
      ) : null}
      {budgets.error || error || compareError ? <p role="alert">{error ?? budgets.error ?? `Couldn't load a compared version: ${compareError}`}</p> : null}
      {budgets.error ? <Button variant="outline" size="sm" onClick={budgets.refresh}>Retry budget status</Button> : null}
      <ConfirmDialog tone="default" open={locking} title={`Lock budget ${year}?`}
        description="This saves a new frozen version for all customers and SKUs. Earlier versions stay in history."
        confirmLabel="Lock budget" pendingLabel="Locking…" isPending={pending} onConfirm={lock}
        onCancel={() => { setLocking(false); setError(null); }}>
        <div>
          <label htmlFor={`budget-name-${year}`} className={labelClass}>Name (optional)</label>
          <input id={`budget-name-${year}`} className={inputClass} value={name} maxLength={80}
            placeholder="e.g. Base case" onChange={(event) => setName(event.target.value)} />
        </div>
        <label className={checkRowClass}>
          <input type="checkbox" className="size-4 accent-deep-violet-blue" checked={makeOfficial || !history.length}
            disabled={!history.length} onChange={(event) => setMakeOfficial(event.target.checked)} />
          Make this the official budget (the Budget line on Forecast and Inventory)
        </label>
        {!history.length ? <p className={hintClass}>The year&apos;s first version is always official.</p> : null}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      </ConfirmDialog>
      <ConfirmDialog open={Boolean(deleting)} title={deleting ? `Delete ${budgetVersionLabel(deleting)}?` : ''}
        description="It will no longer be listed here, so it can't be compared, started from or made official. This can't be undone."
        details={deleting ? [{ label: 'Locked', value: `${formatDateTime(deleting.locked_at)} by ${deleting.locked_by}` },
          { label: 'Total', value: `${units(deleting.total_units)} units` }] : undefined}
        confirmLabel="Delete version" pendingLabel="Deleting…" isPending={deletePending} onConfirm={deleteVersion}
        onCancel={() => { setDeleting(null); setDeleteError(null); }}>
        {deleteError ? <p role="alert" className="text-sm text-destructive">{deleteError}</p> : null}
      </ConfirmDialog>
      <BudgetStartDialog open={starting} year={year} history={history} entryCount={entryCount}
        onCancel={() => setStarting(false)} onStarted={() => { setStarting(false); onRestarted?.(); }} />
    </div>
  );
}
