'use client';

import { useState } from 'react';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { checkRowClass } from '@/components/ui/formStyles';
import { startBudget } from '@/app/services/budgetsApi';
import { budgetVersionLabel } from '@/app/utils/budgetPlanning';
import { formatDateTime } from '@/lib/formatDate';
import { cn } from '@/lib/utils';

const SCRATCH = 'scratch';

function units(value) {
  return Math.round(Number(value) || 0).toLocaleString('en-US');
}

/**
 * Start a year's budget over: copy a locked version's entries in to edit
 * and lock again, or clear them and start from the Initial Yearly Forecast
 * alone (POST /api/scenario/budgets/start). Locked versions never change.
 * The latest version is picked first.
 *
 * @param {{
 *   open: boolean,
 *   year: number,
 *   history: { version: number, name: string | null, is_official: boolean, total_units: number, locked_at: string, locked_by: string }[],
 *   entryCount: number,
 *   onCancel: () => void,
 *   onStarted: () => void,
 * }} props
 */
export default function BudgetStartDialog({ open, year, history, entryCount, onCancel, onStarted }) {
  const [choice, setChoice] = useState(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const selected = choice ?? history[0]?.version ?? SCRATCH;
  const picked = history.find((item) => item.version === selected);

  function close() {
    setChoice(null);
    setError(null);
    onCancel();
  }

  async function start() {
    setPending(true);
    setError(null);
    try {
      await startBudget(year, selected === SCRATCH ? null : selected);
      setChoice(null);
      onStarted();
    } catch (err) {
      setError(err.message);
    } finally {
      setPending(false);
    }
  }

  const options = [
    ...history.map((item, index) => ({
      value: item.version,
      label: `${budgetVersionLabel(item)}${index === 0 ? ' · latest' : ''}${item.is_official ? ' · official' : ''}`,
      detail: `${units(item.total_units)} units · locked ${formatDateTime(item.locked_at)} by ${item.locked_by}`,
    })),
    { value: SCRATCH, label: 'From scratch', detail: 'The Initial Yearly Forecast alone, with no growth, blocks or promotions.' },
  ];

  return (
    <ConfirmDialog
      tone="default"
      open={open}
      title={`Start budget ${year} from…`}
      description={`${entryCount ? `This replaces the ${entryCount} saved budget ${entryCount === 1 ? 'entry' : 'entries'} for ${year}. ` : ''}Locked versions never change; lock again to save the result as a new version.`}
      confirmLabel={picked ? `Start from version ${picked.version}` : 'Start from scratch'}
      pendingLabel="Starting…"
      isPending={pending}
      onConfirm={start}
      onCancel={close}
    >
      <fieldset className="space-y-1">
        <legend className="sr-only">Start from</legend>
        {options.map((option) => (
          <label key={option.value} className={cn(checkRowClass, 'items-start border border-lavander py-2')}>
            <input type="radio" name={`budget-start-${year}`} checked={selected === option.value}
              onChange={() => setChoice(option.value)} className="mt-0.5 size-4 accent-deep-violet-blue" />
            <span className="min-w-0">
              <span className="block font-medium">{option.label}</span>
              <span className="block text-xs text-deep-violet-blue/60">{option.detail}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </ConfirmDialog>
  );
}
