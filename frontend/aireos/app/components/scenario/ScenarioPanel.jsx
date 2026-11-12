'use client';

import { ChevronsLeft, ChevronsRight } from 'lucide-react';

import TabTransition from '@/components/ui/TabTransition';
import { glassSurfaceClass } from '@/components/ui/surfaceStyles';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const triggerClass =
  'h-6 px-2.5 text-[11px] text-deep-violet-blue/70 hover:bg-white hover:text-deep-violet-blue data-active:bg-deep-violet-blue data-active:text-white data-active:hover:bg-deep-violet-blue data-active:hover:text-white';

const TABS = [
  { value: 'breakdown', label: 'Breakdown' },
  { value: 'blocks', label: 'Building blocks' },
  { value: 'promotions', label: 'Promotions' },
];

/**
 * Right-hand column of the Scenario builder (blueprint Part 1.2 and 4.2):
 * the Breakdown tab and a Building blocks / Promotions tab per source.
 * Collapsing shrinks it to a strip naming the selected tab. The page owns
 * the tab, so opening a block from the
 * Monthly plan can switch to it.
 *
 * Shared file: the two sections arrive as slots, so each side edits its own
 * section component, not this one.
 *
 * @param {{
 *   plan?: 'scenario' | 'budget',
 *   collapsed: boolean,
 *   onCollapsedChange: (collapsed: boolean) => void,
 *   tab: 'breakdown' | 'blocks' | 'promotions',
 *   onTabChange: (tab: string) => void,
 *   breakdownSection: import('react').ReactNode,
 *   blocksSection: import('react').ReactNode,
 *   promotionsSection: import('react').ReactNode,
 * }} props
 */
export default function ScenarioPanel({
  plan = 'scenario',
  collapsed,
  onCollapsedChange,
  tab,
  onTabChange,
  breakdownSection,
  blocksSection,
  promotionsSection,
}) {
  const budget = plan === 'budget';
  const selected = TABS.find((item) => item.value === tab) ?? TABS[0];

  if (collapsed) {
    return (
      <aside
        aria-label={budget ? 'Budget planning' : 'Scenario builder'}
        className={`${glassSurfaceClass} flex items-center justify-center gap-3 py-3 min-[1100px]:flex-col`}
      >
        <button
          type="button"
          onClick={() => onCollapsedChange(false)}
          aria-label={`Expand ${selected.label.toLowerCase()}`}
          className="flex size-8 items-center justify-center rounded-md border border-lavander text-deep-violet-blue hover:bg-cream"
        >
          <ChevronsLeft className="size-4" />
        </button>
        <span className="text-xs font-semibold text-deep-violet-blue/70 min-[1100px]:rotate-180 min-[1100px]:[writing-mode:vertical-rl]">
          {selected.label}
        </span>
      </aside>
    );
  }

  return (
    <aside
      aria-label={budget ? 'Budget planning' : 'Scenario builder'}
      className={`${glassSurfaceClass} flex flex-col overflow-hidden text-deep-violet-blue`}
    >
      <div className="flex items-start justify-between gap-2 border-b border-lavander px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="font-serif text-base text-deep-violet-blue">{budget ? 'Your budget' : 'Your scenario'}</p>
          <p className="text-[11px] text-deep-violet-blue/60">
            {budget ? 'Adjustments to the Initial Yearly Forecast' : 'What-ifs on top of the Current forecast'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onCollapsedChange(true)}
          aria-label={`Collapse ${selected.label.toLowerCase()}`}
          className="flex size-8 shrink-0 items-center justify-center rounded-md border border-lavander hover:bg-cream"
        >
          <ChevronsRight className="size-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <Tabs value={tab} onValueChange={onTabChange}>
          <TabsList className="h-7 bg-lavander p-0.5">
            {TABS.map((item) => (
              <TabsTrigger key={item.value} value={item.value} className={triggerClass}>
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabTransition value={tab}>
            <TabsContent value="breakdown" className="pt-2">{breakdownSection}</TabsContent>
            <TabsContent value="blocks" className="pt-2">{blocksSection}</TabsContent>
            <TabsContent value="promotions" className="pt-2">{promotionsSection}</TabsContent>
          </TabTransition>
        </Tabs>
      </div>
    </aside>
  );
}
