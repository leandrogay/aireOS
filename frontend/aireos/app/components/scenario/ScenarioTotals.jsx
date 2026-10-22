'use client';

import { useState } from 'react';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const triggerClass =
  'h-6 px-2.5 text-[11px] text-deep-violet-blue/70 hover:bg-white hover:text-deep-violet-blue data-active:bg-deep-violet-blue data-active:text-white data-active:hover:bg-deep-violet-blue data-active:hover:text-white';

/**
 * The tables under the Scenario builder chart: By year (Current against
 * Simulated per year) and By month (the monthly plan, summed over whatever
 * the filters select). Opens on By month once a customer and SKU are both
 * picked, until the user picks a tab themselves.
 *
 * @param {{
 *   singleSeries: boolean,                     a customer and a SKU are selected
 *   yearTable: import('react').ReactNode,
 *   monthlyPlan: import('react').ReactNode,    only rendered while its tab is open
 * }} props
 */
export default function ScenarioTotals({ singleSeries, yearTable, monthlyPlan }) {
  const [picked, setPicked] = useState(null);
  const tab = picked ?? (singleSeries ? 'month' : 'year');

  return (
    <Tabs value={tab} onValueChange={setPicked}>
      <TabsList className="h-7 bg-lavander p-0.5">
        <TabsTrigger value="year" className={triggerClass}>By year</TabsTrigger>
        <TabsTrigger value="month" className={triggerClass}>By month</TabsTrigger>
      </TabsList>
      <TabsContent value="year" className="pt-2">{yearTable}</TabsContent>
      <TabsContent value="month" className="pt-2">
        {tab === 'month' ? monthlyPlan : null}
      </TabsContent>
    </Tabs>
  );
}
