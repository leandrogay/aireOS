'use client';

import SegmentedControl from '@/components/ui/SegmentedControl';

/**
 * Offline / Online for the whole Sales Dashboard (the chart, the summary and
 * the ranking all follow it), at the top right of the trend card beside the
 * Period controls. The `soft` look keeps the chosen channel distinct from
 * the chart's metric and grouping controls. 152px wide and size sm, like the By week / By month switch in
 * RevenueTrendCard, so the right-aligned controls line up on both edges.
 * Online is disabled when no ticked customer sells online (NHG).
 *
 * @param {{ mode: 'offline' | 'online', onChange: (mode: string) => void, onlineEnabled?: boolean }} props
 */
export default function ChannelSwitch({ mode, onChange, onlineEnabled = true }) {
  return (
    <SegmentedControl
      look="tint"
      fullWidth
      className="w-[152px]"
      value={mode}
      onChange={onChange}
      options={[
        { value: 'offline', label: 'Offline' },
        {
          value: 'online',
          label: 'Online',
          disabled: !onlineEnabled,
          disabledReason: 'None of the ticked customers sell online.',
        },
      ]}
      ariaLabel="Sales channel"
    />
  );
}
