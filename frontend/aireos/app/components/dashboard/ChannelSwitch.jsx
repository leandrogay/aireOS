'use client';

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

// A soft, see-through track with the chosen channel as a white pill on it:
// lighter than the solid navy of the view switches below it, so choosing the
// data (channel) reads differently from choosing how to draw it. A hairline
// outline and a faint shadow on both make them read as a button.
const triggerClass =
  'px-2.5 font-medium text-deep-violet-blue/55 hover:text-deep-violet-blue data-active:bg-white data-active:text-deep-violet-blue data-active:shadow-sm data-active:ring-1 data-active:ring-violet/30';

/**
 * Offline / Online for the whole Sales Dashboard (the chart, the summary and
 * the ranking all follow it), at the top right of the trend card beside the
 * Period controls. 26px tall, the height of those buttons (text-xs, py-1 and
 * a 1px border). 135px wide, the width the By week / By month switch below
 * it draws at, so the two right-aligned switches line up on both edges; the
 * two options share it equally (TabsTrigger is flex-1). Online is disabled when no ticked customer
 * sells online (NHG).
 *
 * @param {{ mode: 'offline' | 'online', onChange: (mode: string) => void, onlineEnabled?: boolean }} props
 */
export default function ChannelSwitch({ mode, onChange, onlineEnabled = true }) {
  return (
    <Tabs value={mode} onValueChange={onChange}>
      <TabsList aria-label="Sales channel" className="h-[26px] w-[135px] bg-lavander/45 p-0.5 group-data-horizontal/tabs:h-[26px] shadow-sm ring-1 ring-violet/25 backdrop-blur-sm">
        <TabsTrigger value="offline" className={`text-xs ${triggerClass}`}>
          Offline
        </TabsTrigger>
        <TabsTrigger value="online" disabled={!onlineEnabled} className={`text-xs ${triggerClass}`}>
          Online
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
