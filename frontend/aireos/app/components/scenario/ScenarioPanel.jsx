'use client';

import { ChevronsLeft, ChevronsRight } from 'lucide-react';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const triggerClass =
  'h-6 px-2.5 text-[11px] text-deep-violet-blue/70 hover:bg-white hover:text-deep-violet-blue data-active:bg-deep-violet-blue data-active:text-white data-active:hover:bg-deep-violet-blue data-active:hover:text-white';

/**
 * Right-hand column of the Scenario builder (blueprint Part 1.2 and 4.2):
 * the draft's name, a Building blocks / Promotions tab per source, and the
 * commit button. Collapsing shrinks it to a strip with the item count.
 *
 * Shared file: the two sections arrive as slots, so each side edits its own
 * section component, not this one.
 *
 * @param {{
 *   collapsed: boolean,
 *   onCollapsedChange: (collapsed: boolean) => void,
 *   itemCount: number,
 *   draftName: string,
 *   onRenameDraft: (name: string) => void,
 *   blocksSection: import('react').ReactNode,
 *   promotionsSection: import('react').ReactNode,
 * }} props
 */
export default function ScenarioPanel({
  collapsed,
  onCollapsedChange,
  itemCount,
  draftName,
  onRenameDraft,
  blocksSection,
  promotionsSection,
}) {
  if (collapsed) {
    return (
      <aside
        aria-label="Scenario builder"
        className="flex items-center justify-center gap-3 rounded-lg border border-lavander bg-white py-3 min-[1100px]:sticky min-[1100px]:top-4 min-[1100px]:flex-col"
      >
        <button
          type="button"
          onClick={() => onCollapsedChange(false)}
          aria-label="Expand building blocks"
          className="flex size-8 items-center justify-center rounded-md border border-lavander text-deep-violet-blue hover:bg-cream"
        >
          <ChevronsLeft className="size-4" />
        </button>
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-scenario px-1.5 text-[11px] font-bold text-white">
          {itemCount}
        </span>
        <span className="text-xs font-semibold text-deep-violet-blue/70 min-[1100px]:rotate-180 min-[1100px]:[writing-mode:vertical-rl]">
          Building blocks
        </span>
      </aside>
    );
  }

  return (
    <aside
      aria-label="Scenario builder"
      className="flex flex-col overflow-hidden rounded-lg border border-lavander bg-white text-deep-violet-blue min-[1100px]:sticky min-[1100px]:top-4 min-[1100px]:max-h-[calc(100dvh-2rem)]"
    >
      <div className="flex items-start justify-between gap-2 border-b border-lavander px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <label htmlFor="draft-name" className="block text-[11px] text-deep-violet-blue/60">
            Draft name
          </label>
          <input
            id="draft-name"
            value={draftName}
            onChange={(event) => onRenameDraft(event.target.value)}
            className="w-full rounded border border-transparent bg-transparent font-serif text-base text-deep-violet-blue hover:border-lavander focus:border-violet focus:outline-none"
          />
        </div>
        <button
          type="button"
          onClick={() => onCollapsedChange(true)}
          aria-label="Collapse building blocks"
          className="flex size-8 shrink-0 items-center justify-center rounded-md border border-lavander hover:bg-cream"
        >
          <ChevronsRight className="size-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <p className="mb-3 flex items-start gap-2 rounded-md bg-scenario-soft px-2.5 py-2 text-[11px] text-scenario-ink">
          <span className="mt-1 size-1.5 shrink-0 rounded-full bg-scenario" aria-hidden="true" />
          Changes show on the chart instantly and stay in this draft.
        </p>
        <Tabs defaultValue="blocks">
          <TabsList className="h-7 bg-lavander p-0.5">
            <TabsTrigger value="blocks" className={triggerClass}>Building blocks</TabsTrigger>
            <TabsTrigger value="promotions" className={triggerClass}>Promotions</TabsTrigger>
          </TabsList>
          <TabsContent value="blocks" className="pt-2">{blocksSection}</TabsContent>
          <TabsContent value="promotions" className="pt-2">{promotionsSection}</TabsContent>
        </Tabs>
      </div>

      <div className="space-y-1.5 border-t border-lavander px-3 py-3">
        {/* Needs the backend commit (blueprint Part 3 and Part 4.4), which
            waits on open questions 1, 3, 4 and 5. */}
        <button
          type="button"
          disabled
          className="h-9 w-full rounded-md bg-deep-violet-blue text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          Set draft as Current forecast
        </button>
        <p className="text-center text-[11px] text-deep-violet-blue/50">
          Coming soon: updates the Current forecast on Forecast, Inventory and Dashboard in one step. Actual
          sell-out is never changed.
        </p>
      </div>
    </aside>
  );
}
