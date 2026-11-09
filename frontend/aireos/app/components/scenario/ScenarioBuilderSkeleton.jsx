import CardSkeleton, { SkeletonBars } from '@/components/ui/CardSkeleton';
import DataTable from '@/components/ui/DataTable';
import LineChartSkeleton from '@/components/ui/LineChartSkeleton';
import PageSkeleton from '@/components/ui/PageSkeleton';
import { blockColumns } from './columns';

// The real block table's columns with the customer shown, as on the default
// All customers view. Built once: the columns are fixed.
const BLOCK_COLUMNS = blockColumns(true);

/**
 * Placeholder for ScenarioBuilder while the forecast filter options load
 * (its `!ready` state): the chart card and the "Your scenario" panel in the
 * same grid as the loaded page, and the building-blocks table under them.
 *
 * Each piece hands over to the real one without moving: the chart area is
 * the LineChartSkeleton that ForecastChart shows on its own first load, and
 * the table is DataTable's first-load state, which BlockTable shows while
 * the blocks are still on their way.
 */
export default function ScenarioBuilderSkeleton() {
  return (
    <PageSkeleton label="Loading scenario builder…" className="space-y-3">
      {/* Same columns as ScenarioBuilder with the panel open (its default). */}
      <div className="grid items-start gap-3 min-[1100px]:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)] min-[1100px]:items-stretch">
        <CardSkeleton className="min-w-0" bodyClassName="space-y-3">
          {/* ForecastFilters toolbar: product, customer, date range, clear. */}
          <SkeletonBars widths={['w-44', 'w-44', 'w-56', 'w-20']} inline className="h-8 rounded-md" />
          {/* Line toggles on the left, promo overlay toggles on the right. */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-lavander px-3 py-2">
            <SkeletonBars count={4} widths={['w-24']} inline className="h-6 rounded-full" />
            <SkeletonBars count={2} widths={['w-20']} inline className="h-6 rounded-full" />
          </div>
          {/* Same box as ForecastChart's first-load skeleton: Actual, Initial, Current and Simulated on. */}
          <div className="pl-1 pr-3 pt-2">
            <LineChartSkeleton points={12} lines={4} height={220} fill tiltXTicks className="h-[34vh]" />
            <div className="mt-1 flex justify-center px-3 pb-1">
              <SkeletonBars widths={['w-72 max-w-full']} className="h-3" />
            </div>
          </div>
          {/* ScenarioTotals: the year comparison. */}
          <SkeletonBars count={3} layout="grid grid-cols-3 gap-2" className="h-12 rounded-md" />
        </CardSkeleton>

        <CardSkeleton subtitle actions={1} divider className="min-w-0" bodyClassName="space-y-3">
          {/* Building blocks | Promotions tabs, then the block cards. */}
          <SkeletonBars widths={['w-28', 'w-24']} inline className="h-7 rounded-md" />
          <SkeletonBars count={4} className="h-16 rounded-md" />
        </CardSkeleton>
      </div>

      <DataTable
        label="Building blocks"
        noun="building block"
        totalCount={0}
        isLoading
        columns={BLOCK_COLUMNS}
        minWidth="62rem"
      />
    </PageSkeleton>
  );
}
