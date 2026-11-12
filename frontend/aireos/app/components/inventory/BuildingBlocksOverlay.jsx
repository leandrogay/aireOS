'use client';

import Link from 'next/link';

import MultiSelectDropdown from '@/components/ui/MultiSelectDropdown';
import ToggleField from '@/components/ui/ToggleField';
import { formatMonth } from '@/app/utils/inventoryForm';
import { upliftLabel } from '@/app/utils/scenarioBlocks';

function monthsLabel(block) {
  const first = formatMonth(block.startMonth);
  const last = formatMonth(block.endMonth);
  return first === last ? first : `${first} – ${last}`;
}

/**
 * The switch and picker for the sell-in plan chart's building blocks
 * overlay: building blocks saved in the Scenario builder, added to the
 * Current sell-out forecast with the plan worked out again on it (backend
 * get_sell_in_outlook's block_ids). A what-if only, like the Scenario
 * builder: the plan and its table stay as they are. Unframed: SellInPlanView
 * puts it in one card with the Show locked yearly budget switch.
 *
 * @param {{
 *   enabled: boolean,
 *   onEnabledChange: (enabled: boolean) => void,
 *   blocks: object[],
 *   blockIds: number[],
 *   onBlockIdsChange: (blockIds: number[]) => void,
 *   customerLabel: string,
 *   loading?: boolean,
 *   error?: string | null,
 *   withoutEffect?: string[],
 * }} props `blocks`: the customer's saved blocks (utils/buildingBlocksOverlay
 *   customerBlocks); `withoutEffect`: names of picked blocks that change
 *   nothing on the chart.
 */
export default function BuildingBlocksOverlay({
  enabled,
  onEnabledChange,
  blocks,
  blockIds,
  onBlockIdsChange,
  customerLabel,
  loading = false,
  error = null,
  withoutEffect = [],
}) {
  const options = blocks.map((block) => ({
    value: String(block.blockId),
    label: block.name,
    hint: `${upliftLabel(block)} · ${block.sku || 'All SKUs'} · ${monthsLabel(block)}`,
  }));

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <ToggleField
          label="Building blocks overlay"
          align="center"
          checked={enabled}
          onChange={onEnabledChange}
          offHint="Show building blocks saved in the Scenario builder on the chart."
          onHint="The dash-dot lines are the forecast and plan with the picked blocks. The plan below doesn't change."
        />
        {/* Shown (disabled) while the saved blocks load, so the switch never
            seems to do nothing. */}
        {enabled && (loading || options.length > 0) && (
          <MultiSelectDropdown
            ariaLabel="Building blocks to apply"
            options={options}
            values={blockIds.map(String)}
            onChange={(values) => onBlockIdsChange(values.map(Number))}
            noneMeansAll={false}
            allLabel="All building blocks"
            placeholder={loading ? 'Loading saved building blocks…' : 'Pick building blocks'}
            disabled={loading}
            look="filter"
            searchable={options.length > 6}
            searchPlaceholder="Search building blocks…"
            className="w-full sm:w-72"
          />
        )}
      </div>

      {enabled && error && (
        <p className="mt-2 text-xs text-deep-violet-blue" role="alert">
          {error}
        </p>
      )}
      {enabled && !error && !loading && options.length === 0 && (
        <p className="mt-2 text-xs text-deep-violet-blue/70">
          No building blocks saved for {customerLabel} yet.{' '}
          <Link href="/scenario" className="font-medium text-deep-violet-blue underline underline-offset-2">
            Save some in the Scenario builder
          </Link>
          .
        </p>
      )}
      {enabled && withoutEffect.length > 0 && (
        <p className="mt-2 text-xs text-deep-violet-blue/70">
          {withoutEffect.join(', ')} {withoutEffect.length === 1 ? "doesn't" : "don't"} change this chart: no
          Current forecast for {withoutEffect.length === 1 ? 'its' : 'their'} SKUs and months here.
        </p>
      )}
    </div>
  );
}
