'use client';

import { Tag } from 'lucide-react';

import { cn } from '@/lib/utils';
import StatusPill from '@/components/ui/StatusPill';
import { Switch } from '@/components/ui/switch';
import { retailerLabel } from '@/app/utils/retailerLabel';
import { hasUnsavedChanges, upliftLabel } from '@/app/utils/scenarioBlocks';
import { monthSpanLabel } from '@/app/utils/scenarioPitch';

function blockSummary(block) {
  const span = monthSpanLabel([block.startMonth, block.endMonth].filter(Boolean));
  return `${block.sku || 'All SKUs'} · ${upliftLabel(block)} · ${span}`;
}

// One short status line per block, most important first: an unsaved block
// would be lost on leaving, so that outranks being switched off.
function blockStatus(block, inView) {
  if (!block.saved) return { text: 'Not saved yet', tone: 'unsaved' };
  if (hasUnsavedChanges(block)) return { text: 'Unsaved changes', tone: 'unsaved' };
  if (!block.isActive) return { text: 'Saved, not on the chart', tone: 'muted' };
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
 * }} props impacts = simulate().byItem
 */
export default function BlockList({ blocks, selectedId, onSelect, onToggle, impacts }) {
  return (
    <ul className="space-y-1.5">
      {blocks.map((block) => {
        const status = blockStatus(block, impacts.has(block.id));
        const selected = block.id === selectedId;
        return (
          <li
            key={block.id}
            className={cn(
              'flex items-center gap-2 rounded-md border pr-2.5 transition',
              selected ? 'border-scenario bg-scenario-soft' : 'border-lavander bg-white hover:bg-cream/60'
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
                  {retailerLabel(block.customer)} · {block.name}
                </span>
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
            <StatusPill tone={block.isActive ? 'success' : 'muted'}>
              {block.isActive ? 'Active' : 'Inactive'}
            </StatusPill>
            <Switch
              checked={block.isActive}
              onCheckedChange={(checked) => onToggle(block, checked)}
              aria-label={`${block.isActive ? 'Make inactive' : 'Make active'}: ${block.name}`}
              title={block.isActive ? 'On the Simulated line' : 'Off the Simulated line'}
              className="data-checked:bg-scenario"
            />
          </li>
        );
      })}
    </ul>
  );
}
