'use client';

import { LockKeyhole } from 'lucide-react';

import InfoTooltip from '@/components/ui/InfoTooltip';
import { Button } from '@/components/ui/button';
import { formatMonthLabel } from '@/app/utils/forecastView';
import { PART_COLORS } from '@/app/utils/scenarioComposition';
import { milestoneTotals } from '@/app/utils/scenarioMilestones';

// The chart's shaded layers, bottom to top (scenarioComposition.js; the
// chart stacks them in this order), one colour each (PART_COLORS). What
// takes units away is hatched above the Simulated line in its part's colour.
export const COMPOSITION_LAYERS = [
  { key: 'baselineLayer', label: 'Baseline', color: PART_COLORS.baseline, opacity: 0.2 },
  { key: 'carriedLayer', label: "Last year's promotions", color: PART_COLORS.carried, opacity: 0.25 },
  { key: 'officialLayer', label: 'Official promotions', color: PART_COLORS.official, opacity: 0.4 },
  { key: 'growthLayer', label: 'Growth', color: PART_COLORS.growth, opacity: 0.35 },
  { key: 'blocksLayer', label: 'Building blocks', color: PART_COLORS.blocks, opacity: 0.4 },
  { key: 'promotionsLayer', label: 'Scenario promotions', color: PART_COLORS.promotions, opacity: 0.4 },
  { key: 'carriedDownLayer', label: "Last year's promotions (below an ordinary month)", color: PART_COLORS.carried, hatch: true },
  { key: 'officialDownLayer', label: 'Official promotions (below the anchor)', color: PART_COLORS.official, hatch: true },
  { key: 'growthDownLayer', label: 'Growth decreases', color: PART_COLORS.growth, hatch: true },
  { key: 'blocksDownLayer', label: 'Building block decreases', color: PART_COLORS.blocks, hatch: true },
  { key: 'promotionsDownLayer', label: 'Scenario promotion decreases', color: PART_COLORS.promotions, hatch: true },
];

function units(value) {
  return Math.round(Number(value) || 0).toLocaleString('en-US');
}

function signedUnits(value) {
  const number = Math.round(Number(value) || 0);
  if (!number) return '—';
  return `${number < 0 ? '−' : '+'}${Math.abs(number).toLocaleString('en-US')}`;
}

function periodLabel(months) {
  if (!months.length) return '';
  const first = formatMonthLabel(months[0]);
  const last = formatMonthLabel(months[months.length - 1]);
  return first === last ? first : `${first} – ${last}`;
}

// One line of the list, with its chart band's colour.
function Part({ color, label, value, partKey, onSpotlight }) {
  const content = <>
    <span className="inline-flex min-w-0 items-center gap-2">
      <span aria-hidden="true" className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: color }} />
      <span className="truncate">{label}</span>
    </span>
    <span className="shrink-0 font-semibold tabular-nums">{value}</span>
  </>;
  return (
    <li>
      {partKey && onSpotlight ? <Button type="button" variant="ghost" size="sm"
        onPointerEnter={() => onSpotlight(partKey)} onPointerLeave={() => onSpotlight(null)}
        onFocus={() => onSpotlight(partKey)} onBlur={() => onSpotlight(null)}
        aria-label={`${label}: ${value}. Spotlight its area on the chart.`}
        className="-mx-1 flex h-auto w-[calc(100%+0.5rem)] items-center justify-between gap-3 rounded px-1 py-1 text-left text-xs font-normal transition-colors hover:bg-lavander/60 focus-visible:bg-lavander/60 motion-reduce:transition-none">
        {content}
      </Button> : <div className="flex items-center justify-between gap-3 py-1">{content}</div>}
    </li>
  );
}

const GROUP_CLASS = 'mt-2 text-[10px] font-bold uppercase tracking-wide text-deep-violet-blue/55';

/**
 * The Scenario builder's Breakdown tab: the growth control (a slot, since
 * it saves through the page's blocks; Budget planning only) and what the Simulated line is made of
 * over the months on the chart (scenarioComposition.breakdownTotals): what
 * the forecast already holds, then what is added here in the sidebar, each
 * with its chart band's colour. Month by month the same parts are the
 * Monthly plan's columns.
 *
 * @param {{
 *   plan?: 'scenario' | 'budget',
 *   growthSection: import('react').ReactNode,
 *   tier0Split: { index: Map<string, object> | null, loading: boolean, error: string | null },
 *   totals: ReturnType<typeof import('@/app/utils/scenarioComposition').breakdownTotals>,
 *   milestones: ReturnType<typeof import('@/app/utils/scenarioMilestones').milestoneBreakdown>,
 *   onSpotlight?: (part: string | null) => void,
 * }} props
 */
export default function FrozenBaselinePanel({ plan = 'scenario', growthSection, tier0Split, totals, milestones, onSpotlight }) {
  const budget = plan === 'budget';
  const split = Boolean(tier0Split.index);
  const title = budget ? 'Budget breakdown' : 'Forecast breakdown';
  const period = periodLabel(totals.months);
  // Past months with milestones: their actual, worked back (scenarioMilestones.js).
  const past = milestoneTotals(milestones);

  return (
    <div className="space-y-3" aria-label={title}>
      <div className="flex items-center gap-1.5">
        <LockKeyhole className="size-3.5 text-deep-violet-blue/60" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-deep-violet-blue">{title}</h2>
      </div>

      {growthSection}

      <div className="border-t border-lavander pt-3 text-xs text-deep-violet-blue">
        <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-deep-violet-blue/55">
          What Simulated is made of{period ? ` · ${period}` : ''}
          <InfoTooltip label="About the breakdown">
            {budget ? (
              <>Initial is reconstructed at its own data cut-off: an ordinary-month baseline at the source anchors,
                plus promotion effects carried from its historical sales. Budget promotions replace the carried
                effects for their covered share of a month. Growth and building blocks are adjustments to Initial.</>
            ) : (
              <>The months on the chart added up. In the Current forecast: its Tier 0 split into an ordinary month at the
                anchor and the promotions it carries from last year, with official promotions from the Promotions page in
                their place. Tier 0 already follows recent sales, so there is no growth to add here. Your adjustments: building blocks
                and scenario promotions from this sidebar. Month by month, these are the Monthly plan&apos;s columns.</>
            )}
          </InfoTooltip>
        </p>
        {totals.months.length ? (
          <>
            {/* The baseline differs per tab: Tier 0 of the Current forecast here, Tier 0 of the Initial Yearly Forecast for a budget. */}
            <p className={GROUP_CLASS}>{budget ? 'In the Initial Yearly Forecast · Tier 0' : 'In the Current forecast · Tier 0'}</p>
            <ul>
              {split ? (
                <>
                  <Part partKey="baseline" onSpotlight={onSpotlight} color={PART_COLORS.baseline} label={budget ? 'Baseline at the anchor' : 'Baseline'} value={units(totals.baseline)} />
                  <Part partKey="carried" onSpotlight={onSpotlight} color={PART_COLORS.carried} label={budget ? 'Carried promotion effects' : "Last year's promotions"} value={signedUnits(totals.carried)} />
                  {!budget ? <Part partKey="official" onSpotlight={onSpotlight} color={PART_COLORS.official} label="Official promotions" value={signedUnits(totals.official)} /> : null}
                </>
              ) : (
                <Part partKey="baseline" onSpotlight={onSpotlight} color={PART_COLORS.baseline} label={budget ? 'Initial forecast (unsplit)' : 'Tier 0'} value={units(totals.baseline)} />
              )}
            </ul>
            {budget ? (
              <p className="mt-1 text-[11px] leading-snug text-deep-violet-blue/60">
                {split ? <>Reconstructed at Initial&apos;s own data cut-off{tier0Split.dataCutoff ? ` (${formatMonthLabel(tier0Split.dataCutoff)})` : ''}.
                  {' '}Carried effects remain where you have no budget promotion; elsewhere your promotion replaces its covered share.</>
                  : <>The Initial breakdown is needed before budget adjustments can be previewed or locked.</>}
              </p>
            ) : null}
            <p className={GROUP_CLASS}>Your adjustments</p>
            <ul>
              {budget ? <Part partKey="growth" onSpotlight={onSpotlight} color={PART_COLORS.growth} label="Growth" value={signedUnits(totals.growth)} /> : null}
              <Part partKey="blocks" onSpotlight={onSpotlight} color={PART_COLORS.blocks} label="Building blocks" value={signedUnits(totals.blocks)} />
              <Part partKey="promotions" onSpotlight={onSpotlight} color={PART_COLORS.promotions} label="Scenario promotions" value={signedUnits(totals.promotions)} />
            </ul>
            <p className="mt-2 flex items-center justify-between border-t border-lavander pt-1.5 font-semibold">
              <span>Simulated</span>
              <span className="tabular-nums">{units(totals.simulated)}</span>
            </p>
          </>
        ) : (
          <p className="mt-1 text-[11px] text-deep-violet-blue/60">No forecast months on the chart.</p>
        )}
        {past.months.length ? (
          <div className="mt-3 border-t border-lavander pt-3">
            <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-deep-violet-blue/55">
              What Actual is made of · {periodLabel(past.months)}
              <InfoTooltip label="About milestones">
                Building blocks in months with actual sales are milestones: events behind the actuals. Each one&apos;s
                share is worked back from the actual (a −20% flood on 2,000 means 2,500 without it), so they explain the
                actual and never move a line. Only the months with a milestone are added up.
              </InfoTooltip>
            </p>
            <ul className="mt-1">
              <Part color={PART_COLORS.baseline} label="Without milestones" value={units(past.without)} />
              {past.milestones.map((item) => (
                <Part key={item.itemId} color={PART_COLORS.milestones} label={item.name} value={signedUnits(item.units)} />
              ))}
            </ul>
            <p className="mt-2 flex items-center justify-between border-t border-lavander pt-1.5 font-semibold">
              <span>Actual</span>
              <span className="tabular-nums">{units(past.actual)}</span>
            </p>
          </div>
        ) : null}
        {tier0Split.error ? (
          <p className="mt-2 rounded-md border border-violet bg-lavander/50 px-2.5 py-2 text-xs" role="alert">
            {budget ? 'Initial' : 'Tier 0'} could not be split into its baseline and promotions: {tier0Split.error}
          </p>
        ) : !split && tier0Split.loading ? (
          <p className="mt-2 text-[11px] text-deep-violet-blue/60">
            {budget ? 'Reconstructing Initial at its own data cut-off…' : 'Splitting Tier 0 into its baseline and promotions…'}
          </p>
        ) : null}
      </div>
    </div>
  );
}
