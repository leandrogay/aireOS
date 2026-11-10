'use client';

import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import DatePicker from '@/components/ui/DatePicker';
import { maxYmd, minYmd } from '@/components/ui/DateRangePicker';
import SelectDropdown from '@/components/ui/SelectDropdown';
import { customerLabel } from '@/app/utils/retailerLabel';

const labelClass = 'mb-0.5 block text-[11px] text-deep-violet-blue/70';
// The typed DatePicker box in the compact white look of the dropdowns beside it.
const dateBoxClass = 'h-8 border-violet bg-white px-2 text-xs';
const clearClass =
  'rounded-md border border-deep-violet-blue/30 bg-white px-2 py-0.5 text-[10px] font-medium text-deep-violet-blue transition hover:bg-cream disabled:cursor-not-allowed disabled:opacity-40';

// SKU and customer are the shared ui/SelectDropdown in the same compact look
// as Model beside them (and the Dashboard's filters); '' is "All".
function SkuField({ value, onChange, options }) {
  return (
    <div>
      <span className={labelClass} id="forecast-sku-label">
        SKU
      </span>
      <SelectDropdown
        id="forecast-sku"
        ariaLabel="SKU"
        value={value}
        onChange={onChange}
        options={[{ value: '', label: 'All SKUs' }, ...options.map((name) => ({ value: name, label: name }))]}
        placeholder="All SKUs"
        searchable
        searchPlaceholder="Search SKUs…"
        look="compact"
        size="sm"
        className="w-full"
      />
    </div>
  );
}

function CustomerField({ value, onChange, options }) {
  return (
    <div>
      <span className={labelClass} id="forecast-customer-label">
        Sales customer
      </span>
      <SelectDropdown
        id="forecast-customer"
        ariaLabel="Sales customer"
        value={value}
        onChange={onChange}
        options={[
          { value: '', label: 'All customers' },
          ...options.map((name) => ({ value: name, label: customerLabel(name) })),
        ]}
        placeholder="All customers"
        searchable
        searchPlaceholder="Search customers…"
        look="compact"
        size="sm"
        className="w-full"
      />
    </div>
  );
}

/**
 * From / To as two bounded ui/DatePicker boxes (type dd/mm/yyyy or pick from
 * the calendar). Both stay inside the forecast's data bounds, and each limits
 * the other: From can't be after To, To can't be before From.
 */
function DateRangeFields({ startDate, endDate, onStartDateChange, onEndDateChange, minDate, maxDate }) {
  return (
    <div className="grid grid-cols-2 gap-2 [&>*]:min-w-0">
      <div>
        <label htmlFor="forecast-start-date" className={labelClass}>
          From
        </label>
        <DatePicker
          id="forecast-start-date"
          variant="input"
          value={startDate}
          onChange={onStartDateChange}
          min={minDate || ''}
          max={minYmd(endDate, maxDate) ?? ''}
          boxClassName={dateBoxClass}
        />
      </div>
      <div>
        <label htmlFor="forecast-end-date" className={labelClass}>
          To
        </label>
        <DatePicker
          id="forecast-end-date"
          variant="input"
          value={endDate}
          onChange={onEndDateChange}
          min={maxYmd(startDate, minDate) ?? ''}
          max={maxDate || ''}
          boxClassName={dateBoxClass}
        />
      </div>
    </div>
  );
}

/**
 * The forecast model (tier) every line on the chart shows, for one customer
 * or All customers alike. A model that isn't available for every customer x
 * SKU in scope is greyed out with the reason under it
 * (forecastTiers.modelOptions).
 */
function ModelField({ value, onChange, options }) {
  return (
    <div>
      <span className={labelClass} id="forecast-model-label">
        Model
      </span>
      <SelectDropdown
        id="forecast-model"
        ariaLabel="Model"
        value={value}
        onChange={onChange}
        options={options}
        look="compact"
        size="sm"
        className="w-full"
      />
    </div>
  );
}

/**
 * Forecast filters: SKU, customer, Model (when `model` is given -- /forecast
 * only), date range, Clear. The default is the
 * card /forecast uses. `variant="toolbar"` (Scenario builder only) is the
 * same fields in one row with no card, inside the chart card.
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
  model = null,
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
        <div className="w-full sm:w-80">
          <DateRangeFields
            startDate={startDate}
            endDate={endDate}
            onStartDateChange={onStartDateChange}
            onEndDateChange={onEndDateChange}
            minDate={minDate}
            maxDate={maxDate}
          />
        </div>
        <button type="button" onClick={onClearFilters} disabled={!canClearFilters} className={cn(clearClass, 'mb-1.5')}>
          Clear
        </button>
      </div>
    );
  }

  return (
    <Card className="min-w-0 max-w-full rounded-lg border border-lavander bg-white text-deep-violet-blue shadow-sm ring-0">
      <CardContent className="min-w-0 space-y-2">
        <div className="flex items-center gap-2">
          <p className="font-serif text-base text-deep-violet-blue">Filters</p>
          <button type="button" onClick={onClearFilters} disabled={!canClearFilters} className={clearClass}>
            Clear
          </button>
        </div>

        <div className={cn('grid grid-cols-2 gap-2', model ? 'lg:grid-cols-5' : 'lg:grid-cols-4')}>
          <SkuField value={productName} onChange={onProductNameChange} options={productOptions} />
          <CustomerField value={customerName} onChange={onCustomerNameChange} options={customerOptions} />
          {model ? (
            <div className="col-span-2 lg:col-span-1">
              <ModelField {...model} />
            </div>
          ) : null}

          <div className="col-span-2">
            <DateRangeFields
              startDate={startDate}
              endDate={endDate}
              onStartDateChange={onStartDateChange}
              onEndDateChange={onEndDateChange}
              minDate={minDate}
              maxDate={maxDate}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
