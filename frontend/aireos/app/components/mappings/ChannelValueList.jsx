'use client';

import { CHANNELS } from '@/app/utils/mappingCustomer';
import SegmentedControl from '@/components/ui/SegmentedControl';

/** Offline | Online for one value of the file. */
function ChannelToggle({ value, channel, onChange, disabled }) {
  const options = CHANNELS.map((option) => ({ value: option.value, label: option.label, disabled }));
  return (
    <SegmentedControl
      value={channel}
      onChange={onChange}
      options={options}
      look="tint"
      ariaLabel={`Channel for ${value}`}
      className="shrink-0"
    />
  );
}

/**
 * Every value of the column a split reads, each marked Online or Offline
 * (retailerSplit.valueChannels), and what happens to a value not listed.
 *
 * @param {{
 *   rows: { value: string, channel: 'online' | 'offline' }[],
 *   onChange: (value: string, channel: string) => void,
 *   disabled: boolean,
 * }} props
 */
export default function ChannelValueList({ rows, onChange, disabled }) {
  const online = rows.filter((row) => row.channel === 'online').length;
  return (
    <>
      {/* Solid rows in a clear frame (surfaceStyles.glassTableFrameClass), with a
          thin scrollbar so the long list doesn't carry a heavy bar inside the card. */}
      <ul className="max-h-64 divide-y divide-deep-violet-blue/10 overflow-y-auto rounded-lg border border-deep-violet-blue/15 bg-white [scrollbar-width:thin]">
        {rows.map((row) => (
          <li key={row.value} className="flex items-center gap-2 px-2 py-1">
            <span className="min-w-0 flex-1 truncate font-mono text-xs" title={row.value}>
              {row.value}
            </span>
            <ChannelToggle
              value={row.value}
              channel={row.channel}
              onChange={(channel) => onChange(row.value, channel)}
              disabled={disabled}
            />
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-deep-violet-blue/60">
        {online} online · {rows.length - online} offline. Values that are not here, such as new ones in later files,
        go offline.
      </p>
    </>
  );
}
