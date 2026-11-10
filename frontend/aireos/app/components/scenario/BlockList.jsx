'use client';

import { Tag } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Switch } from '@/components/ui/switch';
import { customerLabel } from '@/app/utils/retailerLabel';
import { blockScopeLabel, hasUnsavedChanges, upliftLabel } from '@/app/utils/scenarioBlocks';
import { monthSpanLabel } from '@/app/utils/scenarioPitch';

function blockSummary(block) {
  const span = monthSpanLabel([block.startMonth, block.endMonth].filter(Boolean));
  return `${blockScopeLabel(block)} · ${upliftLabel(block)} · ${span}`;
}

// What the block adds on the Simulated line, when it is on it.
function impactLine(impact) {
  if (!impact) return null;
  return `+${Math.round(impact.deltaUnits).toLocaleString('en-US')} units`;
}

// One short status line per block, most important first: an unsaved block
// would be lost on leaving, so that outranks being switched off.
function blockStatus(block, inView, closed) {
  if (!block.saved) return { text: 'Not saved yet', tone: 'unsaved' };
  if (hasUnsavedChanges(block)) return { text: 'Unsaved changes', tone: 'unsaved' };
  if (!block.isActive) return { text: 'Saved, not on the chart', tone: 'muted' };
  if (closed) return { text: 'Its months have actual sales, so it changes nothing', tone: 'muted' };
  if (!inView) return { text: 'Not in current chart view', tone: 'muted' };
  return null;
}

/**
 * The building blocks as a list: click one to edit it, and switch it
 * active or inactive to choose whether it counts on the Simulated line.
 *
 * @param {{
 *   blocks: object[],
 *   selectedId: string | null,
 *   onSelect: (id: string) => void,
 *   onToggle: (block: object, isActive: boolean) => void,
 *   impacts: Map<string, object>,
 *   closedIds?: Set<string>,
 *   togglingIds?: string[],
 * }} props impacts = simulate().byItem; closedIds = blocks whose months all have actual sales
 */
export default function BlockList({ blocks, selectedId, onSelect, onToggle, impacts, closedIds = new Set(), togglingIds = [] }) {
  return (
    <ul className="space-y-1.5">
      {blocks.map((block) => {
        const status = blockStatus(block, impacts.has(block.id), closedIds.has(block.id));
        const impact = block.isActive ? impactLine(impacts.get(block.id)) : null;
        const selected = block.id === selectedId;
        return (
          <li
            key={block.id}
            className={cn(
              'flex items-center gap-2 rounded-md border pr-2.5 transition',
              selected ? 'border-deep-violet-blue bg-lavander/40' : 'border-lavander bg-white hover:bg-cream/60'
            )}
          >
            <button
              type="button"
              onClick={() => onSelect(block.id)}
              aria-pressed={selected}
              className={cn(
                'flex min-w-0 flex-1 items-start gap-2 px-2.5 py-2 text-left',
                block.isActive ? null : 'opacity-60'
              )}
            >
              <Tag className="mt-0.5 size-3.5 shrink-0 text-scenario" aria-hidden="true" />
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium text-deep-violet-blue">
                  {customerLabel(block.customer)} · {block.name}
                </span>
                {impact ? (
                  <span className="block truncate text-[11px] font-semibold tabular-nums text-scenario-ink">{impact}</span>
                ) : null}
                <span className="block truncate text-[11px] text-deep-violet-blue/60">{blockSummary(block)}</span>
                {status ? (
                  <span
                    className={cn(
                      'block text-[11px]',
                      status.tone === 'unsaved' ? 'font-medium text-scenario-ink' : 'italic text-deep-violet-blue/50'
                    )}
                  >
                    {status.text}
                  </span>
                ) : null}
              </span>
            </button>
            <Switch
              checked={block.isActive}
              disabled={togglingIds.includes(block.id)}
              onCheckedChange={(checked) => onToggle(block, checked)}
              aria-label={`${block.isActive ? 'Take off the Simulated line' : 'Show on the Simulated line'}: ${block.name}`}
              title={block.isActive ? 'On the Simulated line' : 'Off the Simulated line'}
              className="data-checked:bg-scenario"
            />
          </li>
        );
      })}
    </ul>
  );
}
