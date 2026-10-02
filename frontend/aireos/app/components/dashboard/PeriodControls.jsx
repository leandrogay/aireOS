'use client';

import CompareControl from '@/components/dashboard/CompareControl';
import DateRangeControl from '@/components/dashboard/DateRangeControl';
import { parseIso } from '@/app/utils/periodComparison';

/**
 * The timeframe controls above the trend chart: Period, Compare to, and how
 * far the loaded data goes ("Data to 5 Aug"). They sit with the chart, not
 * in the Filter panel, since the timeframe is the first thing to read before
 * the numbers. page.js owns the state; this only lays the controls out.
 *
 * @param {{
 *   start: string,
 *   end: string,
 *   presets: Array<{ id: string, label: string, start: string, end: string }>,
 *   latestWeekStart: string,
 *   latestDataEnd: string,
 *   onDateRangeChange: (start: string, end: string) => void,
 *   compareTo: string,
 *   compareOptions: Array<object>,
 *   onCompareChange: (value: string, customRange?: { start: string, end: string }) => void,
 * }} props
 */
export default function PeriodControls({
  start,
  end,
  presets,
  latestWeekStart,
  latestDataEnd,
  onDateRangeChange,
  compareTo,
  compareOptions,
  onCompareChange,
}) {
  // latestDataEnd is the real last day loaded (may be a whole month's end,
  // not always latestWeekStart + 6 days).
  const dataThrough = latestDataEnd
    ? parseIso(latestDataEnd).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    : null;

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div>
        <p className="mb-0.5 text-xs text-deep-violet-blue/70">Period</p>
        <DateRangeControl
          start={start}
          end={end}
          presets={presets}
          latestWeekStart={latestWeekStart}
          latestDataEnd={latestDataEnd}
          onChange={onDateRangeChange}
        />
      </div>
      <div>
        <p className="mb-0.5 text-xs text-deep-violet-blue/70">Compare to</p>
        <CompareControl
          value={compareTo}
          options={compareOptions}
          latestWeekStart={latestWeekStart}
          latestDataEnd={latestDataEnd}
          onChange={onCompareChange}
        />
      </div>
      {dataThrough && <span className="pb-1 text-xs text-deep-violet-blue/60">Data to {dataThrough}</span>}
    </div>
  );
}
