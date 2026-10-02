'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { uniqueSkuRangeLabels } from '@/app/utils/promotionForm';
import { promotionRetailerNames, promotionStores } from '@/app/utils/promotionOverview';
import { retailerLabel } from '@/app/utils/retailerLabel';

// Stores shown before "Show all", about four rows of the three-column list.
const COLLAPSED_STORE_COUNT = 12;
const NO_FORMAT = 'Other';

/**
 * Format tabs for the store list, with a count each, most common first.
 *
 * @param {object[]} stores
 * @returns {Array<{ format: string, count: number }>}
 */
function formatCounts(stores) {
  const counts = new Map();
  for (const store of stores) {
    const format = store.store_format || NO_FORMAT;
    counts.set(format, (counts.get(format) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([format, count]) => ({ format, count }))
    .sort((left, right) => right.count - left.count || left.format.localeCompare(right.format));
}

function FormatTab({ label, count, selected, onSelect }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50',
        selected
          ? 'border-deep-violet-blue bg-deep-violet-blue text-white'
          : 'border-lavander bg-white text-deep-violet-blue hover:bg-lavander',
      )}
    >
      {label}
      <span className={cn('tabular-nums', selected ? 'text-white/70' : 'text-deep-violet-blue/50')}>
        {count}
      </span>
    </button>
  );
}

/**
 * Every linked store of one promotion: format tabs to narrow the list, then
 * plain names in columns. Long lists start collapsed so the page never gets a
 * scroll box inside a scroll box.
 */
function StoreList({ stores, showRetailer }) {
  const [format, setFormat] = useState('');
  const [showAll, setShowAll] = useState(false);

  if (!stores.length) return <p className="text-sm text-deep-violet-blue/70">No stores linked.</p>;

  const tabs = formatCounts(stores);
  const visibleStores = format
    ? stores.filter((store) => (store.store_format || NO_FORMAT) === format)
    : stores;
  const shown = showAll ? visibleStores : visibleStores.slice(0, COLLAPSED_STORE_COUNT);
  const hidden = visibleStores.length - shown.length;

  // A new tab starts collapsed again so its count reads true.
  const selectFormat = (next) => {
    setFormat(next);
    setShowAll(false);
  };

  return (
    <div>
      {tabs.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          <FormatTab
            label="All"
            count={stores.length}
            selected={format === ''}
            onSelect={() => selectFormat('')}
          />
          {tabs.map((tab) => (
            <FormatTab
              key={tab.format}
              label={tab.format}
              count={tab.count}
              selected={format === tab.format}
              onSelect={() => selectFormat(tab.format)}
            />
          ))}
        </div>
      )}

      <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((store) => {
          const name = store.store_name || store.store_code;
          return (
            <li
              key={store.store_id ?? `${store.retailer}|${store.store_code}`}
              title={[store.retailer, name, store.store_format].filter(Boolean).join(' · ')}
              className="flex min-w-0 items-baseline justify-between gap-2 border-b border-lavander/60 pb-1.5 text-sm"
            >
              <span className="truncate font-medium text-deep-violet-blue">
                {showRetailer && (
                  <span className="font-normal text-deep-violet-blue/60">
                    {retailerLabel(store.retailer)} ·{' '}
                  </span>
                )}
                {name}
              </span>
              {!format && store.store_format && (
                <span className="shrink-0 text-xs text-deep-violet-blue/50">{store.store_format}</span>
              )}
            </li>
          );
        })}
      </ul>

      {(hidden > 0 || showAll) && visibleStores.length > COLLAPSED_STORE_COUNT && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 text-deep-violet-blue"
          onClick={() => setShowAll((current) => !current)}
        >
          {showAll ? 'Show fewer' : `Show all ${visibleStores.length} stores`}
        </Button>
      )}
    </div>
  );
}

/**
 * What the table has no room for: every linked store, the voucher and the SKU
 * ranges of one promotion. Shown under its row when the row is expanded.
 *
 * @param {{ promotion: object }} props
 */
export default function PromotionDetails({ promotion }) {
  const stores = promotionStores(promotion);
  const skuLabels = uniqueSkuRangeLabels(promotion.skus);
  const showRetailer = promotionRetailerNames(promotion).length > 1;

  return (
    <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <section className="min-w-0 rounded-lg border border-lavander/80 bg-white p-4">
        <h3 className="mb-3 text-sm font-medium text-deep-violet-blue">
          Stores <span className="text-deep-violet-blue/50">({stores.length})</span>
        </h3>
        {/* Keyed on the promotion so opening another row never inherits this
            row's selected tab or expanded state. */}
        <StoreList key={promotion.promotion_id} stores={stores} showRetailer={showRetailer} />
      </section>

      <section className="min-w-0 divide-y divide-lavander/80 rounded-lg border border-lavander/80 bg-white text-sm">
        <div className="p-4">
          <h3 className="text-xs font-medium text-deep-violet-blue/60">Voucher</h3>
          <p className="mt-1 break-words font-medium text-deep-violet-blue">
            {promotion.voucher || '-'}
          </p>
        </div>
        <div className="p-4">
          <h3 className="text-xs font-medium text-deep-violet-blue/60">SKU range</h3>
          {skuLabels.length ? (
            <ul className="mt-1 space-y-1 font-medium text-deep-violet-blue">
              {skuLabels.map((label) => (
                <li key={label} className="break-words">
                  {label}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 font-medium text-deep-violet-blue">-</p>
          )}
        </div>
      </section>
    </div>
  );
}
