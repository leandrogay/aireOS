'use client';

import { LockKeyhole } from 'lucide-react';

import LineToggle from '@/components/ui/LineToggle';

// The chart's shaded layers, bottom to top (scenarioComposition.js; the
// chart stacks them in this order). Tier 0 is its ordinary-month baseline
// (kept faint) and the promotions it carries from last year; official and
// scenario promotions are two shades of the promotion colour. What takes
// units away is hatched above the Simulated line, in its own colour.
export const COMPOSITION_LAYERS = [
  { key: 'baselineLayer', label: 'Baseline', color: '#3A4369', opacity: 0.08 },
  { key: 'carriedLayer', label: "Last year's promotions", color: '#3A4369', opacity: 0.22 },
  { key: 'officialLayer', label: 'Official promotions', color: '#D68B6D', opacity: 0.6 },
  { key: 'growthLayer', label: 'Growth', color: '#5E8C6A', opacity: 0.35 },
  { key: 'blocksLayer', label: 'Building blocks', color: '#8E7CC3', opacity: 0.35 },
  { key: 'promotionsLayer', label: 'Scenario promotions', color: '#D68B6D', opacity: 0.3 },
  { key: 'carriedDownLayer', label: "Last year's promotions (below an ordinary month)", color: '#3A4369', hatch: true },
  { key: 'officialDownLayer', label: 'Official promotions (below the anchor)', color: '#D68B6D', hatch: true },
  { key: 'decreaseLayer', label: 'Decreases', color: '#D23F74', hatch: true },
];

// What the Simulated line can count, each with its layer's colour; the
// baseline is always in. `split`: needs Tier 0 split into its baseline and
// the promotions it carries.
export const SIMULATED_PARTS = [
  {
    key: 'carried',
    label: "Last year's promotions",
    color: '#3A4369',
    split: true,
    hint: "The promotions Tier 0 carries from last year's month and the run-rate months. Off: Simulated starts from an ordinary month at the anchor.",
  },
  {
    key: 'official',
    label: 'Official promotions',
    color: '#D68B6D',
    split: true,
    hint: "Promotions planned on the Promotions page, in place of last year's in their months.",
  },
  { key: 'growth', label: 'Growth', color: '#5E8C6A', hint: 'The growth set above, on Tier 0.' },
  { key: 'blocks', label: 'Building blocks', color: '#8E7CC3', hint: 'The switched-on building blocks.' },
  { key: 'promotions', label: 'Scenario promotions', color: '#D68B6D', hint: 'The switched-on promotions planned here.' },
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
        <LineToggle
          label="In the Simulated line"
          visible={included}
          onToggle={onToggle}
          series={SIMULATED_PARTS.map((part) => ({ key: part.key, label: part.label, color: part.color, shape: 'square' }))}
          hints={Object.fromEntries(
            SIMULATED_PARTS.map((part) => [part.key, part.split && waiting ? splitHint : part.hint])
          )}
          disabled={Object.fromEntries(SIMULATED_PARTS.map((part) => [part.key, Boolean(part.split && waiting)]))}
        />
        <p className="text-[11px] text-deep-violet-blue/60">
          The baseline (an ordinary month at the anchor) is always in. Hatched bands above the line are what a part takes
          away. Month-by-month numbers are in the Monthly plan under the chart.
        </p>
        {tier0Split.error ? (
          <p className="rounded-md border border-violet bg-lavander/50 px-2.5 py-2 text-xs text-deep-violet-blue" role="alert">
            Tier 0 could not be split into its baseline and promotions: {tier0Split.error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
