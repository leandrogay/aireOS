'use client';

import { useState } from 'react';
import SegmentedControl from '@/components/ui/SegmentedControl';
import ScenarioBuilder from '@/components/scenario/ScenarioBuilder';
import { singaporeToday } from '@/lib/singaporeTime';

/** Keep each mode mounted after opening it so switching preserves unsaved drafts. */
export default function ScenarioWorkspace() {
  const [plan, setPlan] = useState('scenario');
  const [openedBudget, setOpenedBudget] = useState(false);
  const year = singaporeToday().getFullYear() + 1;
  return (
    <div className="space-y-3">
      <SegmentedControl ariaLabel="Planning mode" value={plan} onChange={(next) => { setPlan(next); if (next === 'budget') setOpenedBudget(true); }}
        options={[{ value: 'scenario', label: 'Current forecast' }, { value: 'budget', label: 'Budget planning' }]} />
      <div hidden={plan !== 'scenario'}><ScenarioBuilder /></div>
      {openedBudget ? <div hidden={plan !== 'budget'}><ScenarioBuilder plan="budget" budgetYear={year} /></div> : null}
    </div>
  );
}
