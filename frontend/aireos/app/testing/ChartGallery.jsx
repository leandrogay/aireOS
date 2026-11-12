'use client';

import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';

import { ScopeTag } from '@/components/inventory/InventoryChrome';
import SellInOutlookChart from '@/components/inventory/SellInOutlookChart';
import SellInTrendChart from '@/components/inventory/SellInTrendChart';
import BarChartSkeleton from '@/components/ui/BarChartSkeleton';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import ChartCard from '@/components/ui/ChartCard';
import ChartFrame, { CHART_FRAME_CLASS, CHART_TOOLTIP_CLASS } from '@/components/ui/ChartFrame';
import ChartLoading from '@/components/ui/ChartLoading';
import SegmentedControl from '@/components/ui/SegmentedControl';
import { formatMonth, formatUnits } from '@/app/utils/inventoryForm';
import { AXIS_TICK, BAR_ANIMATION, MAX_BAR_SIZE, chartDataRange, metricYAxisProps } from '@/app/utils/trendChart';

import { NotMigrated, Panel, Section, Variant, WhichToUse } from './GalleryParts';

// A living reference for the chart kit; see app/testing/page.js. The charts
// are the real Inventory ones (SellInTrendChart, SellInOutlookChart) fed
// made-up monthly units, nothing is fetched, so they look exactly as they do
// on the page. The chart blocks are `bare`: on the wallpaper, as on a page,
// since a glass card over the gallery's white panel reads as flat white.

// ==== Sample data and reference tables ====

// One year of sell-in, the shape of backend get_customer_view `trend`.
const SAMPLE_TREND = [
  ['2025-10', 1240], ['2025-11', 980], ['2025-12', 1410], ['2026-01', 1120],
  ['2026-02', 1530], ['2026-03', 1290], ['2026-04', 1360], ['2026-05', 1180],
  ['2026-06', 1450], ['2026-07', 1600], ['2026-08', 1320], ['2026-09', 1480],
].map(([month, sellIn]) => ({ month, sell_in: sellIn }));

// A year of the sell-in plan (backend get_sell_in_outlook `months`): actuals
// to June, the forecast and the plan after it. No Previous forecast, so its
// pills show as unavailable, as for a customer with one forecast run.
const ACTUALS_THROUGH = '2026-06';
const SAMPLE_OUTLOOK = [
  // [month, sell-in, sell-out, Initial sell-in, Initial sell-out]
  ['2026-01', 1320, 1180, 1250, 1200],
  ['2026-02', 1100, 1050, 1150, 1080],
  ['2026-03', 1480, 1290, 1300, 1260],
  ['2026-04', 1210, 1240, 1280, 1230],
  ['2026-05', 1390, 1310, 1340, 1300],
  ['2026-06', 1260, 1350, 1360, 1320],
  ['2026-07', 1420, 1380, 1400, 1360],
  ['2026-08', 1510, 1440, 1450, 1410],
  ['2026-09', 1380, 1400, 1420, 1390],
  ['2026-10', 1460, 1430, 1440, 1420],
  ['2026-11', 1620, 1550, 1560, 1520],
  ['2026-12', 1700, 1640, 1650, 1600],
].map(([month, sellIn, sellOut, initialIn, initialOut]) => {
  const actual = month <= ACTUALS_THROUGH;
  return {
    month,
    sell_in_actual: actual ? sellIn : null,
    sell_in_recommended: actual ? null : sellIn,
    sell_in_previous: null,
    sell_in_initial: initialIn,
    sell_out_actual: actual ? sellOut : null,
    sell_out_forecast: actual ? null : sellOut,
    sell_out_initial: initialOut,
    sell_out_previous: null,
    forecast_source: actual ? null : 'current',
  };
});

const CHART_CONFIG = { sell_in: { label: 'Sell-in', color: 'var(--aire-deep-blue)' } };

const SAMPLE_TAGS = [
  { label: 'Customer', value: 'FairPrice' },
  { label: 'SKU', value: 'All SKUs' },
  { label: 'Months', value: 'Oct 2025 – Sep 2026' },
];

const GUIDE = [
  ['Put a chart on a page, with a title', 'ChartCard', 'title, detail (text or scope tags), actions'],
  ['…whose top row is only its controls', 'ChartCard', 'actions, label (no title)'],
  ['The plot area inside the card', 'ChartFrame', 'className; wrap the ChartContainer'],
  ['A control on the plot itself (zoom)', 'ChartFrame toolbar', 'toolbar; chart margin right: 8'],
  ['A chart that grows to the card\'s height', 'ChartCard fill + ChartFrame fill', 'fill on both; ChartContainer CHART_SIZE_CLASS'],
  ['A first-load placeholder the chart\'s size', 'BarChartSkeleton / LineChartSkeleton', 'className={CHART_FRAME_CLASS}, height = the chart\'s'],
  ['Dim the old chart while it refetches', 'ChartLoading overlay', 'overlay, label; inside a relative parent'],
  ['A tooltip', 'ChartTooltipContent', 'className={CHART_TOOLTIP_CLASS}'],
];

// Every page chart is on the kit; add a row here if a new one isn't yet.
const NOT_MIGRATED = [];

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

// The bare plot for the old-vs-new comparison, which needs a chart without
// its own frame. Drawn like SellInTrendChart (280px, tilted month labels,
// the shared unit axis), without its frame or entry transition.
function FramelessTrendChart() {
  const rows = SAMPLE_TREND.map((row) => ({ ...row, label: formatMonth(row.month) }));
  const yAxisProps = metricYAxisProps('units', chartDataRange(rows, ['sell_in']));
  return (
    <ChartContainer config={CHART_CONFIG} className="aspect-auto h-[280px] w-full">
      <BarChart accessibilityLayer data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" interval={0} height={52} tick={AXIS_TICK} angle={-40} textAnchor="end" tickMargin={6} />
        <YAxis domain={yAxisProps.domain} ticks={yAxisProps.ticks} width={48} tick={AXIS_TICK} tickFormatter={formatUnits} />
        <ChartTooltip content={<ChartTooltipContent className={CHART_TOOLTIP_CLASS} />} />
        <Bar dataKey="sell_in" fill="var(--color-sell_in)" radius={[10, 10, 0, 0]} maxBarSize={MAX_BAR_SIZE} {...BAR_ANIMATION} />
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

// The four states every chart card renders, in the same frame so nothing
// moves: as Inventory's Customer tab (CustomerInventoryView, InventoryChartSlot).
function StatefulCard({ state }) {
  return (
    <ChartCard title="Sell-in trend" detail={<SampleTags />}>
      {state === 'first' && (
        <BarChartSkeleton bars={SAMPLE_TREND.length} height={280} label="Loading chart…" className={CHART_FRAME_CLASS} />
      )}
      {state === 'empty' && <SellInTrendChart trend={[]} />}
      {(state === 'loaded' || state === 'refresh') && (
        <div className="relative">
          <SellInTrendChart trend={SAMPLE_TREND} />
          {state === 'refresh' && <ChartLoading overlay label="Updating chart…" />}
        </div>
      )}
    </ChartCard>
  );
}

// ==== Gallery ====

export default function ChartGallery() {
  const [state, setState] = useState('loaded');
  const [view, setView] = useState('units');

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
        space. Keep heights in the chart component (Inventory uses 280, 308 and 360px; the dashboard&apos;s trend card
        is <span className="font-mono">fill</span>, its chart growing to the card&apos;s height, min 220px). A chart with
        its own tooltip rows (the dashboard&apos;s) keeps ChartTooltipContent&apos;s box with{' '}
        <span className="font-mono">CHART_TOOLTIP_CLASS</span>.
      </WhichToUse>

      <Panel
        bare
        title="Chart card — ChartCard + ChartFrame"
        note="Inventory's Sell-in trend card with sample data. Switch the state: first load (skeleton in the frame), refreshing (the old chart dimmed under ChartLoading's overlay) and empty. Hover a bar for the tooltip."
      >
        <SegmentedControl value={state} onChange={setState} options={STATES} ariaLabel="Chart state" className="mb-3" />
        <StatefulCard state={state} />
      </Panel>

      <Section bare title="Header variants" note="ChartCard's header is optional; every variant draws in the same ChartFrame. Controls for the card (metric, period) go in actions; a control on the plot itself goes in the frame's toolbar, its right edge in line with the end of the plot.">
        <div className="sm:col-span-2 lg:col-span-2">
          <Variant name="Title + actions" props="title, detail, actions" value={view}>
            <ChartCard title="Sell-in trend" detail="Monthly, FairPrice" actions={viewSwitch}>
              <SellInTrendChart trend={SAMPLE_TREND} />
            </ChartCard>
          </Variant>
        </div>
        <div className="sm:col-span-2 lg:col-span-2">
          <Variant name="Controls only (no title)" props="actions, label" value={view}>
            <ChartCard label="Sell-in trend" actions={viewSwitch}>
              <SellInTrendChart trend={SAMPLE_TREND} />
            </ChartCard>
          </Variant>
        </div>
        <div className="sm:col-span-2 lg:col-span-4">
          <Variant name="Toolbar on the plot (Sell-in plan zoom)" props="ChartFrame toolbar" value={null}>
            <ChartCard title="Sell-in and sell-out" detail={<SampleTags />}>
              <SellInOutlookChart months={SAMPLE_OUTLOOK} actualsThrough={ACTUALS_THROUGH} />
            </ChartCard>
          </Variant>
        </div>
      </Section>

      <NotMigrated bare rows={NOT_MIGRATED} leaveAsIs={LEAVE_AS_IS}>
        <div className="sm:col-span-2 lg:col-span-2">
          <Variant name="Old: white framed plot box" props="own classes per file" value={null}>
            <ChartCard title="Sell-in trend">
              <div className="overflow-visible rounded-xl border border-lavander bg-white pl-1 pr-3 pt-2">
                <FramelessTrendChart />
              </div>
            </ChartCard>
          </Variant>
        </div>
        <div className="sm:col-span-2 lg:col-span-2">
          <Variant name="New: ChartFrame (one panel)" props="ChartCard > ChartFrame" value={null}>
            <ChartCard title="Sell-in trend">
              <ChartFrame>
                <FramelessTrendChart />
              </ChartFrame>
            </ChartCard>
          </Variant>
        </div>
      </NotMigrated>
    </div>
  );
}
