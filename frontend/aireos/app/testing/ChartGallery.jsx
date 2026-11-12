'use client';

import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';

import { ScopeTag } from '@/components/inventory/InventoryChrome';
import BarChartSkeleton from '@/components/ui/BarChartSkeleton';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import ChartCard from '@/components/ui/ChartCard';
import ChartFrame, { CHART_FRAME_CLASS, CHART_TOOLTIP_CLASS } from '@/components/ui/ChartFrame';
import ChartLoading from '@/components/ui/ChartLoading';
import ChartZoomButton from '@/components/ui/ChartZoomButton';
import SegmentedControl from '@/components/ui/SegmentedControl';
import { AXIS_TICK, MAX_BAR_SIZE } from '@/app/utils/trendChart';

import { NotMigrated, Panel, Section, Variant, WhichToUse } from './GalleryParts';

// A living reference for the chart kit; see app/testing/page.js. The bars are
// made-up monthly units, nothing is fetched.

// ==== Sample data and reference tables ====

const SAMPLE_ROWS = [
  { month: 'Apr', units: 1240 },
  { month: 'May', units: 980 },
  { month: 'Jun', units: 1410 },
  { month: 'Jul', units: 1120 },
  { month: 'Aug', units: 1530 },
  { month: 'Sep', units: 1290 },
];

const CHART_CONFIG = { units: { label: 'Units', color: 'var(--aire-deep-blue)' } };

const SAMPLE_TAGS = [
  { label: 'Customer', value: 'FairPrice' },
  { label: 'SKU', value: 'All SKUs' },
  { label: 'Months', value: 'Apr – Sep 2026' },
];

const GUIDE = [
  ['Put a chart on a page, with a title', 'ChartCard', 'title, detail (text or scope tags), actions'],
  ['…whose top row is only its controls', 'ChartCard', 'actions, label (no title)'],
  ['The plot area inside the card', 'ChartFrame', 'className; wrap the ChartContainer'],
  ['A control on the plot itself (zoom)', 'ChartFrame toolbar', 'toolbar; chart margin right: 8'],
  ['A first-load placeholder the chart\'s size', 'BarChartSkeleton / LineChartSkeleton', 'className={CHART_FRAME_CLASS}, height = the chart\'s'],
  ['Dim the old chart while it refetches', 'ChartLoading overlay', 'overlay, label; inside a relative parent'],
  ['A tooltip', 'ChartTooltipContent', 'className={CHART_TOOLTIP_CLASS}'],
];

// Remove a row when its page migrates.
const NOT_MIGRATED = [
  ['Dashboard', 'dashboard/RevenueTrendCard', 'GlassPanel, chart straight in the card', 'ChartCard (actions = the view switches) + ChartFrame'],
  ['Dashboard', 'dashboard/TrendChart, CustomerTrendChart', 'Hand-rolled tooltip box', 'ChartTooltipContent + CHART_TOOLTIP_CLASS, or keep the custom rows inside that class'],
  ['Dashboard', 'dashboard/ComparisonLineChart, ComparisonMixChart', 'Chart straight in the card', 'ChartFrame'],
  ['Forecast, Scenario', 'forecast/ForecastChart', 'Own glass Card + CardHeader, hand-copied frame padding', 'ChartCard + ChartFrame'],
];

const LEAVE_AS_IS = [
  ['Assistant', 'assistant/AssistantMessage (AssistantChart)', 'A small chart inside a chat message, not a page card'],
];

const STATES = [
  { value: 'loaded', label: 'Loaded' },
  { value: 'first', label: 'First load' },
  { value: 'refresh', label: 'Refreshing' },
  { value: 'empty', label: 'Empty' },
];

const VIEWS = [
  { value: 'units', label: 'Units' },
  { value: 'revenue', label: 'Revenue' },
];

// ==== Pieces ====

function SampleChart({ height = 220 }) {
  return (
    <ChartContainer config={CHART_CONFIG} className="aspect-auto w-full" style={{ height }}>
      <BarChart accessibilityLayer data={SAMPLE_ROWS} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="month" tick={AXIS_TICK} tickMargin={6} />
        <YAxis width={48} tick={AXIS_TICK} />
        <ChartTooltip content={<ChartTooltipContent className={CHART_TOOLTIP_CLASS} />} />
        <Bar dataKey="units" fill="var(--color-units)" radius={[10, 10, 0, 0]} maxBarSize={MAX_BAR_SIZE} />
      </BarChart>
    </ChartContainer>
  );
}

function SampleTags() {
  return (
    <div className="mt-1 flex flex-wrap gap-1.5">
      {SAMPLE_TAGS.map((tag) => (
        <ScopeTag key={tag.label} label={tag.label} value={tag.value} />
      ))}
    </div>
  );
}

// The four states every chart card renders, in the same frame so nothing moves.
function StatefulCard({ state }) {
  return (
    <ChartCard title="Sell-in trend" detail={<SampleTags />}>
      {state === 'first' && (
        <BarChartSkeleton bars={SAMPLE_ROWS.length} height={220} label="Loading chart…" className={CHART_FRAME_CLASS} />
      )}
      {state === 'empty' && <p className="text-sm text-deep-violet-blue/70">No data for these filters.</p>}
      {(state === 'loaded' || state === 'refresh') && (
        <ChartFrame>
          <SampleChart />
          {state === 'refresh' && <ChartLoading overlay label="Updating chart…" />}
        </ChartFrame>
      )}
    </ChartCard>
  );
}

// ==== Gallery ====

export default function ChartGallery() {
  const [state, setState] = useState('loaded');
  const [view, setView] = useState('units');
  const [picking, setPicking] = useState(false);

  const viewSwitch = (
    <SegmentedControl look="glass" size="sm" value={view} onChange={setView} options={VIEWS} ariaLabel="Metric" />
  );

  return (
    <div>
      <WhichToUse
        rows={GUIDE}
        note="Put every page chart in a ChartCard and draw it in a ChartFrame, the solid chart panel (the glass washes out pale series colours). Inventory is the reference."
      >
        Give the skeleton the frame class and the chart&apos;s height so the placeholder takes exactly the chart&apos;s
        space. Keep heights in the chart component (Inventory uses 280, 308 and 360px; the dashboard grows with{' '}
        <span className="font-mono">flex-1</span>, min 220px).
      </WhichToUse>

      <Panel
        title="Chart card — ChartCard + ChartFrame"
        note="A titled card with scope tags, as on the Inventory tabs. Switch the state: first load (skeleton in the frame), refreshing (the old chart dimmed under ChartLoading's overlay) and empty. Hover a bar for the tooltip."
      >
        <SegmentedControl value={state} onChange={setState} options={STATES} ariaLabel="Chart state" className="mb-3" />
        <StatefulCard state={state} />
      </Panel>

      <Section title="Header variants" note="ChartCard's header is optional; every variant draws in the same ChartFrame. Controls for the card (metric, period) go in actions; a control on the plot itself goes in the frame's toolbar, its right edge in line with the end of the plot.">
        <div className="sm:col-span-2 lg:col-span-2">
          <Variant name="Title + actions" props="title, detail, actions" value={view}>
            <ChartCard title="Revenue trend" detail="Monthly, all customers" actions={viewSwitch}>
              <ChartFrame>
                <SampleChart height={180} />
              </ChartFrame>
            </ChartCard>
          </Variant>
        </div>
        <div className="sm:col-span-2 lg:col-span-2">
          <Variant name="Controls only (no title)" props="actions, label" value={view}>
            <ChartCard label="Revenue trend" actions={viewSwitch}>
              <ChartFrame>
                <SampleChart height={180} />
              </ChartFrame>
            </ChartCard>
          </Variant>
        </div>
        <div className="sm:col-span-2 lg:col-span-2">
          <Variant name="Toolbar on the plot (Sell-in plan zoom)" props="ChartFrame toolbar" value={picking}>
            <ChartCard title="Sell-in and sell-out">
              <ChartFrame
                toolbar={(
                  <ChartZoomButton
                    picking={picking}
                    zoomed={false}
                    onPick={() => setPicking(true)}
                    onCancel={() => setPicking(false)}
                    onReset={() => setPicking(false)}
                    align="end"
                  />
                )}
              >
                <SampleChart height={180} />
              </ChartFrame>
            </ChartCard>
          </Variant>
        </div>
      </Section>

      <NotMigrated rows={NOT_MIGRATED} leaveAsIs={LEAVE_AS_IS}>
        <div className="sm:col-span-2 lg:col-span-2">
          <Variant name="Old: white framed plot box" props="own classes per file" value={null}>
            <ChartCard title="Ending stock by month">
              <div className="overflow-visible rounded-xl border border-lavander bg-white pl-1 pr-3 pt-2">
                <SampleChart height={180} />
              </div>
            </ChartCard>
          </Variant>
        </div>
        <div className="sm:col-span-2 lg:col-span-2">
          <Variant name="New: ChartFrame (one panel)" props="ChartCard > ChartFrame" value={null}>
            <ChartCard title="Ending stock by month">
              <ChartFrame>
                <SampleChart height={180} />
              </ChartFrame>
            </ChartCard>
          </Variant>
        </div>
      </NotMigrated>
    </div>
  );
}
