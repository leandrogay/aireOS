'use client';

import { LockKeyhole } from 'lucide-react';

import InfoTooltip from '@/components/ui/InfoTooltip';
import ToggleField from '@/components/ui/ToggleField';

// The chart's shaded layers, bottom to top (scenarioComposition.js; the
// chart stacks them in this order), in three tones that stay clear of the
// forecast lines' colours (checked with the data-viz palette validator):
// Tier 0 in greys (its baseline, and the promotions it carries from last
// year), promotions in blue (official and scenario, two shades), and growth
// and building blocks in the Simulated line's crimson. What takes units away
// is hatched above the Simulated line in its part's tone.
const TIER0_GREY = '#9CA3AF';
const CARRIED_GREY = '#6B7280';
const PROMOTION_BLUE = '#5B8DEF';
const SCENARIO_CRIMSON = '#D23F74';

export const COMPOSITION_LAYERS = [
  { key: 'baselineLayer', label: 'Baseline', color: TIER0_GREY, opacity: 0.15 },
  { key: 'carriedLayer', label: "Last year's promotions", color: CARRIED_GREY, opacity: 0.3 },
  { key: 'officialLayer', label: 'Official promotions', color: PROMOTION_BLUE, opacity: 0.5 },
  { key: 'growthLayer', label: 'Growth', color: SCENARIO_CRIMSON, opacity: 0.32 },
  { key: 'blocksLayer', label: 'Building blocks', color: SCENARIO_CRIMSON, opacity: 0.2 },
  { key: 'promotionsLayer', label: 'Scenario promotions', color: PROMOTION_BLUE, opacity: 0.25 },
  { key: 'carriedDownLayer', label: "Last year's promotions (below an ordinary month)", color: CARRIED_GREY, hatch: true },
  { key: 'officialDownLayer', label: 'Official promotions (below the anchor)', color: PROMOTION_BLUE, hatch: true },
  { key: 'decreaseLayer', label: 'Decreases', color: SCENARIO_CRIMSON, hatch: true },
];

// What the Simulated line can count; the baseline is always in. `split`:
// needs Tier 0 split into its baseline and the promotions it carries.
export const SIMULATED_PARTS = [
  { key: 'carried', label: "Last year's promotions", split: true },
  { key: 'official', label: 'Official promotions', split: true },
  { key: 'growth', label: 'Growth' },
  { key: 'blocks', label: 'Building blocks' },
  { key: 'promotions', label: 'Scenario promotions' },
];

/**
 * The Scenario builder's Breakdown tab: the growth control (a slot, since
 * it saves through the page's blocks) and which parts the Simulated line
 * counts. A part switched off leaves the line, its shading and both tables;
 * the numbers month by month are in the Monthly plan, where each month opens
 * to show how its Tier 0 is built.
 *
 * @param {{
 *   growthSection: import('react').ReactNode,
 *   included: Record<string, boolean>,
 *   onToggle: (key: string) => void,
 *   tier0Split: { index: Map<string, object> | null, loading: boolean, error: string | null },
 * }} props
 */
export default function FrozenBaselinePanel({ growthSection, included, onToggle, tier0Split }) {
  // Last year's and official promotions need the split; until it is in they
  // are greyed out, with the reason on hover.
  const waiting = !tier0Split.index;
  const splitHint = tier0Split.error
    ? `Not available: Tier 0 could not be split (${tier0Split.error}).`
    : 'Loading the baseline and promotions…';

  return (
    <div className="space-y-3" aria-label="Forecast breakdown">
      <div className="flex items-center gap-1.5">
        <LockKeyhole className="size-3.5 text-deep-violet-blue/60" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-deep-violet-blue">Forecast breakdown</h2>
      </div>

      {growthSection}

      <div className="space-y-1.5 border-t border-lavander pt-3">
        {/* Switches, not the chart's line pills: these choose what Simulated
            counts, they are not a second legend. */}
        <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-deep-violet-blue/55">
          In the Simulated line
          <InfoTooltip label="About what the Simulated line counts">
            Last year&apos;s promotions: what Tier 0 carries from the same month last year and the recent months; off, Simulated
            starts from an ordinary month at the anchor. Official promotions: planned on the Promotions page, in place of
            last year&apos;s. Growth: set above. Building blocks and scenario promotions: the switched-on ones. The baseline is
            always in; hatched bands above the line are what a part takes away.
          </InfoTooltip>
        </p>
        <div className="space-y-1.5">
          {SIMULATED_PARTS.map((part) => {
            const waitingHere = Boolean(part.split && waiting);
            return (
              <ToggleField
                key={part.key}
                label={part.label}
                checked={Boolean(included[part.key])}
                onChange={() => onToggle(part.key)}
                disabled={waitingHere}
                onHint={waitingHere ? splitHint : undefined}
                offHint={waitingHere ? splitHint : undefined}
                tone="scenario"
              />
            );
          })}
        </div>
        <p className="text-[11px] text-deep-violet-blue/60">Month-by-month numbers are in the Monthly plan under the chart.</p>
        {tier0Split.error ? (
          <p className="rounded-md border border-violet bg-lavander/50 px-2.5 py-2 text-xs text-deep-violet-blue" role="alert">
            Tier 0 could not be split into its baseline and promotions: {tier0Split.error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
