'use client';

import { CHANNELS } from '@/app/utils/mappingCustomer';
import { cn } from '@/lib/utils';

/** Online | Offline for one value of the file. */
function ChannelToggle({ value, channel, onChange, disabled }) {
  return (
    <div role="group" aria-label={`Channel for ${value}`} className="flex shrink-0 rounded-md border border-lavander p-0.5">
      {CHANNELS.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={channel === option.value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded px-2 py-0.5 text-[11px] font-medium',
            channel === option.value
              ? 'bg-deep-violet-blue text-white'
              : 'text-deep-violet-blue/60 hover:bg-cream hover:text-deep-violet-blue',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
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
      <ul className="max-h-64 divide-y divide-lavander overflow-y-auto rounded-md border border-lavander">
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
