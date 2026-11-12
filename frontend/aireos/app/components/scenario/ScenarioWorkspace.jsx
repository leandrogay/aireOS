'use client';

import { useState } from 'react';
import SegmentedControl from '@/components/ui/SegmentedControl';
import ScenarioBuilder from '@/components/scenario/ScenarioBuilder';
import { budgetYears } from '@/app/utils/budgetPlanning';
import useForecastInitialStatus from '@/hooks/useForecastInitialStatus';
import { singaporeToday } from '@/lib/singaporeTime';

/**
 * Keep each mode, and each budget year, mounted after opening it so
 * switching preserves unsaved drafts. Starting a budget over (from a locked
 * version or from scratch) remounts that year so it reads its new entries.
 */
export default function ScenarioWorkspace() {
  const [plan, setPlan] = useState('scenario');
  const initialStatus = useForecastInitialStatus();
  const years = budgetYears(initialStatus.data, singaporeToday().getFullYear());
  const [pickedYear, setPickedYear] = useState(null);
  // Next year once its Initial is out, until another year is picked.
  const year = years.includes(pickedYear) ? pickedYear : years[years.length - 1];
  const [openedYears, setOpenedYears] = useState([]);
  const [restarts, setRestarts] = useState({});
  // The year in view is always mounted, even when the year list changes
  // under it (next year's Initial status arriving after the tab was opened).
  const mountedYears = plan === 'budget' && !openedYears.includes(year) ? [...openedYears, year] : openedYears;

  function openBudgetYear(next) {
    setPickedYear(next);
    setOpenedYears((current) => (current.includes(next) ? current : [...current, next]));
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl ariaLabel="Planning mode" value={plan} onChange={(next) => { setPlan(next); if (next === 'budget') openBudgetYear(year); }}
          options={[{ value: 'scenario', label: 'Current forecast' }, { value: 'budget', label: 'Budget planning' }]} />
        {plan === 'budget' && years.length > 1 ? (
          <SegmentedControl ariaLabel="Budget year" value={String(year)} onChange={(next) => openBudgetYear(Number(next))}
            options={years.map((item) => ({ value: String(item), label: `Budget ${item}` }))} />
        ) : null}
      </div>
      <div hidden={plan !== 'scenario'}><ScenarioBuilder /></div>
      {mountedYears.map((item) => (
        <div key={`${item}-${restarts[item] ?? 0}`} hidden={plan !== 'budget' || item !== year}>
          <ScenarioBuilder plan="budget" budgetYear={item}
            onBudgetRestarted={() => setRestarts((current) => ({ ...current, [item]: (current[item] ?? 0) + 1 }))} />
        </div>
      ))}
    </div>
  );
}
