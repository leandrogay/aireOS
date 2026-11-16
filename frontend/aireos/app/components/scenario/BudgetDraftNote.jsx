'use client';

import { Button } from '@/components/ui/button';
import { draftBaseLabel } from '@/app/utils/budgetPlanning';
import { formatDateTime } from '@/lib/formatDate';
import { cn } from '@/lib/utils';

/**
 * What a year's Budget scenario builds on, shown wherever its entries are
 * (the sidebar's Building blocks and Promotions tabs, both saved tables), so
 * it is never a guess: the version it was started from or scratch, when and
 * by whom (budget_drafts, migration 033). Entries saved before starts were
 * recorded are kept and said to be of unknown origin. Not started yet, it says
 * so with a Start from… button; with no record kept (033 not applied), it says that.
 *
 * @param {{
 *   budgets: { data: { draft: object | null, drafts_enabled?: boolean, history: object[] }, loading: boolean, error: string | null },
 *   savedEntries: number,
 *   onStart: () => void,
 *   className?: string,
 * }} props
 */
export default function BudgetDraftNote({ budgets, savedEntries, onStart, className }) {
  const { draft, drafts_enabled: enabled, history } = budgets.data;
  if (budgets.error) {
    return (
      <p role="alert" className={cn('rounded-md border border-red-200 bg-red-50 px-2.5 py-2 text-[11px] leading-snug text-red-800', className)}>
        Can&apos;t check what this budget builds on: {budgets.error}
      </p>
    );
  }
  if (budgets.loading && !draft) {
    return <p role="status" className={cn('text-[11px] text-deep-violet-blue/60', className)}>Checking what this budget builds on…</p>;
  }
  if (draft) {
    return (
      <p role="status" className={cn('rounded-md border border-violet/40 bg-lavander/40 px-2.5 py-2 text-[11px] leading-snug text-deep-violet-blue', className)}>
        Budget scenario builds on <b>{draftBaseLabel(draft, history)}</b>
        {' '}· started {formatDateTime(draft.started_at)} by {draft.started_by}.
      </p>
    );
  }
  // Saved before starts were recorded: kept as they are, and said so.
  if (savedEntries > 0) {
    return (
      <div role="status" className={cn('flex flex-wrap items-center justify-between gap-2 rounded-md border border-violet/40 bg-lavander/40 px-2.5 py-2 text-[11px] leading-snug text-deep-violet-blue', className)}>
        <span>Budget scenario builds on its {savedEntries} saved {savedEntries === 1 ? 'entry' : 'entries'}; what {savedEntries === 1 ? 'it' : 'they'} started from wasn&apos;t recorded.</span>
        <Button type="button" size="sm" variant="outline" onClick={onStart}>Start from…</Button>
      </div>
    );
  }
  if (enabled === false) {
    return (
      <p role="alert" className={cn('rounded-md border border-red-200 bg-red-50 px-2.5 py-2 text-[11px] leading-snug text-red-800', className)}>
        What this budget builds on can&apos;t be recorded: migration 033_budget_drafts.sql hasn&apos;t been applied to the database.
      </p>
    );
  }
  return (
    <div role="alert" className={cn('flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-2 text-[11px] leading-snug text-amber-900', className)}>
      <span>Not started: pick what this budget builds on (a locked version or the Initial Yearly Forecast) before adding to it.</span>
      <Button type="button" size="sm" variant="outline" onClick={onStart}>Start from…</Button>
    </div>
  );
}
