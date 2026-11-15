'use client';

import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';

import TabTransition from '@/components/ui/TabTransition';
import { Button } from '@/components/ui/button';
import { glassSurfaceClass } from '@/components/ui/surfaceStyles';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SIDE_PANEL } from '@/app/config/transitions';

const triggerClass =
  'h-6 px-2.5 text-[11px] text-deep-violet-blue/70 hover:bg-white hover:text-deep-violet-blue data-active:bg-deep-violet-blue data-active:text-white data-active:hover:bg-deep-violet-blue data-active:hover:text-white';

// The panel's widths in px on wide screens: the strip and the open panel.
const COLLAPSED_WIDTH = 56;
const OPEN_WIDTH = 340; // keep in step with the open contents' w-[340px]

const TABS = [
  { value: 'breakdown', label: 'Breakdown' },
  { value: 'blocks', label: 'Building blocks' },
  { value: 'promotions', label: 'Promotions' },
];

/**
 * Right-hand column of the Scenario builder (blueprint Part 1.2 and 4.2):
 * the Breakdown tab and a Building blocks / Promotions tab per source.
 * Collapsing shrinks it to a strip naming the selected tab, on a spring
 * (SIDE_PANEL in config/transitions.js). The page owns
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
  const reduceMotion = useReducedMotion();
  const contentMotion = reduceMotion ? {} : {
    initial: { opacity: 0 },
    animate: { opacity: 1, transition: SIDE_PANEL.contentIn },
    exit: { opacity: 0, transition: SIDE_PANEL.contentOut },
  };

  return (
    // One glass panel whose width springs between the strip and the open
    // panel (--panel-width, wide screens only; stacked, it is full width).
    // Its contents swap after the old ones fade, so nothing shows squeezed.
    <motion.aside
      aria-label={budget ? 'Budget planning' : 'Scenario builder'}
      initial={false}
      animate={{ '--panel-width': `${collapsed ? COLLAPSED_WIDTH : OPEN_WIDTH}px` }}
      transition={reduceMotion ? { duration: 0 } : SIDE_PANEL.width}
      className={`${glassSurfaceClass} overflow-hidden text-deep-violet-blue min-[1100px]:h-full min-[1100px]:w-(--panel-width)`}
    >
      <AnimatePresence initial={false} mode="wait">
        {collapsed ? (
          <motion.div
            key="collapsed"
            {...contentMotion}
            className="flex items-center justify-center gap-3 py-3 min-[1100px]:flex-col min-[1100px]:justify-start"
          >
            <Button type="button" variant="outline" size="icon" onClick={() => onCollapsedChange(false)}
              aria-label={`Expand ${selected.label.toLowerCase()}`}>
              <ChevronsLeft />
            </Button>
            <span className="text-xs font-semibold text-deep-violet-blue/70 min-[1100px]:rotate-180 min-[1100px]:[writing-mode:vertical-rl]">
              {selected.label}
            </span>
          </motion.div>
        ) : (
          // Held at the open width while the panel grows or shrinks around
          // it, so its text doesn't rewrap on every frame.
          <motion.div
            key="open"
            {...contentMotion}
            className="flex h-full flex-col min-[1100px]:w-[340px]"
          >
            <div className="flex items-start justify-between gap-2 border-b border-lavander px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="font-serif text-base text-deep-violet-blue">{budget ? 'Your budget' : 'Your scenario'}</p>
                <p className="text-[11px] text-deep-violet-blue/60">
                  {budget ? 'Adjustments to the Initial Yearly Forecast' : 'What-ifs on top of the Current forecast'}
                </p>
              </div>
              <Button type="button" variant="outline" size="icon" className="shrink-0" onClick={() => onCollapsedChange(true)}
                aria-label={`Collapse ${selected.label.toLowerCase()}`}>
                <ChevronsRight />
              </Button>
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
          </motion.div>
        )}
      </AnimatePresence>
    </motion.aside>
  );
}
