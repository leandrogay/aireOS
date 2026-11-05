'use client';

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

// A soft, see-through track with the chosen channel as a white pill on it:
// lighter than the solid navy of the chart's switches, so the page header
// stays calm while still showing which channel is on. A hairline outline and
// a faint shadow on both make them read as a button.
const triggerClass =
  'px-3 font-medium text-deep-violet-blue/55 hover:text-deep-violet-blue data-active:bg-white data-active:text-deep-violet-blue data-active:shadow-sm data-active:ring-1 data-active:ring-violet/30';

/**
 * Offline / Online for the whole Sales Dashboard: the chart, the summary and
 * the ranking all follow it, so it sits beside the page title rather than in
 * one card. A step larger than the chart's own switches, as the page's main
 * view choice. Online is disabled when no ticked customer sells online (NHG).
 *
 * @param {{ mode: 'offline' | 'online', onChange: (mode: string) => void, onlineEnabled?: boolean }} props
 */
export default function ChannelSwitch({ mode, onChange, onlineEnabled = true }) {
  return (
    <Tabs value={mode} onValueChange={onChange}>
      <TabsList aria-label="Sales channel" className="h-8 bg-lavander/45 p-px shadow-sm ring-1 ring-violet/25 backdrop-blur-sm">
        <TabsTrigger value="offline" className={`text-sm ${triggerClass}`}>
          Offline
        </TabsTrigger>
        <TabsTrigger value="online" disabled={!onlineEnabled} className={`text-sm ${triggerClass}`}>
          Online
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
