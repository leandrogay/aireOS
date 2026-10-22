'use client';

import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import DateRangePicker from '@/components/ui/DateRangePicker';
import DateRangeControl from '@/components/ui/DateRangeControl';
import { retailerLabel } from '@/app/utils/retailerLabel';
import { forecastDateRangePresets } from '@/app/utils/dateRange';

const selectClass =
  'h-8 w-full px-2 text-xs rounded-md border bg-white text-deep-violet-blue border-violet disabled:opacity-50';
const labelClass = 'mb-0.5 block text-[11px] text-deep-violet-blue/70';
const clearClass =
  'rounded-md border border-deep-violet-blue/30 bg-white px-2 py-0.5 text-[10px] font-medium text-deep-violet-blue transition hover:bg-cream disabled:cursor-not-allowed disabled:opacity-40';

function SkuField({ value, onChange, options }) {
  return (
    <div>
      <label className={labelClass} htmlFor="forecast-sku">
        SKU
      </label>
      <select
        id="forecast-sku"
        aria-label="SKU"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={selectClass}
      >
        <option value="">All SKUs</option>
        {options.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    </div>
  );
}

function CustomerField({ value, onChange, options }) {
  return (
    <div>
      <label className={labelClass} htmlFor="forecast-customer">
        Sales customer
      </label>
      <select
        id="forecast-customer"
        aria-label="Sales customer"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={selectClass}
      >
        <option value="">All customers</option>
        {options.map((name) => (
          <option key={name} value={name}>
            {retailerLabel(name)}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Forecast filters: SKU, customer, date range, Clear. The default is the
 * card /forecast uses. `variant="toolbar"` (Scenario builder only) is one
 * row with no card, inside the chart card, and picks the period with
 * DateRangeControl (whole months, with presets) instead of two dates.
 */

export default function ForecastFilters({
  productName,
  onProductNameChange,
  productOptions,
  customerName,
  onCustomerNameChange,
  customerOptions,
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  minDate,
  maxDate,
  onClearFilters,
  canClearFilters,
  variant = 'card',
}) {
  if (variant === 'toolbar') {
    return (
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-full sm:w-44">
          <CustomerField value={customerName} onChange={onCustomerNameChange} options={customerOptions} />
        </div>
        <div className="w-full sm:w-44">
          <SkuField value={productName} onChange={onProductNameChange} options={productOptions} />
        </div>
        <div>
          <p className={labelClass}>Period</p>
          <DateRangeControl
            start={startDate}
            end={endDate}
            presets={forecastDateRangePresets({ start: minDate, end: maxDate })}
            earliestDataStart={minDate}
            latestDataEnd={maxDate}
            onChange={(start, end) => {
              onStartDateChange(start);
              onEndDateChange(end);
            }}
          />
        </div>
        <button type="button" onClick={onClearFilters} disabled={!canClearFilters} className={cn(clearClass, 'mb-1.5')}>
          Clear
        </button>
      </div>
    );
  }

  return (
    <Card size="sm" className="rounded-lg border border-lavander bg-white text-deep-violet-blue shadow-sm ring-0">
      <CardContent className="space-y-2">
        <div className="flex items-center gap-2">
          <p className="font-serif text-base text-deep-violet-blue">Filters</p>
          <button type="button" onClick={onClearFilters} disabled={!canClearFilters} className={clearClass}>
            Clear
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <SkuField value={productName} onChange={onProductNameChange} options={productOptions} />
          <CustomerField value={customerName} onChange={onCustomerNameChange} options={customerOptions} />

          <div className="col-span-2">
            <DateRangePicker
              start={startDate}
              end={endDate}
              onStartChange={onStartDateChange}
              onEndChange={onEndDateChange}
              minDate={minDate}
              maxDate={maxDate}
              startLabel="From"
              endLabel="To"
              className="grid-cols-2 gap-2"
              inputClassName="border-violet bg-white h-8"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
