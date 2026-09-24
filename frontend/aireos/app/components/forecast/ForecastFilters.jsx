'use client';

import { Card, CardContent } from '@/components/ui/card';
import DateRangePicker from '@/components/ui/DateRangePicker';
import { retailerLabel } from '@/app/utils/promotionForm';
import { FORECAST_TIERS } from '@/app/utils/forecastView';

const selectClass =
  'h-8 w-full px-2 text-xs rounded-md border bg-white text-deep-violet-blue border-violet disabled:opacity-50';

function formatMetricValue(value, metric) {
  if (value == null) return '—';
  if (metric === 'revenue') {
    return `$${Math.round(value).toLocaleString()}`;
  }
  return `${Math.round(value).toLocaleString()} units`;
}

function StatTag({ label, value }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-lavander bg-lavander/60 px-2.5 py-1 text-[11px] text-deep-violet-blue">
      <span className="font-semibold uppercase tracking-wide text-deep-violet-blue/45">{label}</span>
      <span className="font-medium">{value}</span>
    </span>
  );
}

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
  horizonTotal,
  metric,
  generatedAtLabel,
  tier,
  onTierChange,
}) {
  const canClearFilters = Boolean(
    productName || customerName || startDate !== minDate || endDate !== maxDate
  );

  return (
    <Card size="sm" className="border border-violet/40 text-deep-violet-blue ring-0">
      <CardContent className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <p className="font-serif text-base text-deep-violet-blue">Filters</p>
            <button
              type="button"
              onClick={onClearFilters}
              disabled={!canClearFilters}
              className="rounded-md border border-deep-violet-blue/30 bg-white px-2 py-0.5 text-[10px] font-medium text-deep-violet-blue transition hover:bg-cream disabled:cursor-not-allowed disabled:opacity-40"
            >
              Clear
            </button>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <StatTag label="Next 12 mo" value={formatMetricValue(horizonTotal, metric)} />
            <StatTag label="Generated" value={generatedAtLabel} />
            <div className="inline-flex items-center gap-1 rounded-full border border-lavander bg-white p-0.5">
              <span className="pl-2 text-[10px] font-semibold uppercase tracking-wide text-deep-violet-blue/45">
                Tier
              </span>
              {FORECAST_TIERS.map((option) => {
                const isActive = tier === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => onTierChange(option.value)}
                    className={
                      isActive
                        ? 'rounded-full bg-deep-violet-blue px-2 py-0.5 text-[11px] font-medium text-white'
                        : 'rounded-full px-2 py-0.5 text-[11px] text-deep-violet-blue/70 hover:bg-cream'
                    }
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <div>
            <label className="mb-0.5 block text-[11px] text-deep-violet-blue/70" htmlFor="forecast-sku">
              SKU
            </label>
            <select
              id="forecast-sku"
              aria-label="SKU"
              value={productName}
              onChange={(event) => onProductNameChange(event.target.value)}
              className={selectClass}
            >
              <option value="">All SKUs</option>
              {productOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-0.5 block text-[11px] text-deep-violet-blue/70" htmlFor="forecast-customer">
              Sales customer
            </label>
            <select
              id="forecast-customer"
              aria-label="Sales customer"
              value={customerName}
              onChange={(event) => onCustomerNameChange(event.target.value)}
              className={selectClass}
            >
              <option value="">All customers</option>
              {customerOptions.map((name) => (
                <option key={name} value={name}>
                  {retailerLabel(name)}
                </option>
              ))}
            </select>
          </div>

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
