'use client';

import useSkuSales from '@/hooks/useSkuSales';
import { priceMixEffects } from '@/app/utils/priceMix';

/**
 * The Comparison panel's split of the average-price change into SKU prices
 * vs product mix (see priceMixEffects), from per-SKU units and revenue for
 * this period and the comparison. Fetches only while `baseline` is set;
 * `priceMix` is null until both sides have loaded.
 */
export default function usePriceMix({
  dataVersion = 0,
  customer = '',
  mode = '',
  store = '',
  sku = '',
  startDate = '',
  endDate = '',
  baseline = null,
}) {
  const filters = { dataVersion, customer, mode, store, sku, enabled: Boolean(baseline) };
  const current = useSkuSales({ ...filters, startDate, endDate });
  const comparison = useSkuSales({ ...filters, startDate: baseline?.start ?? '', endDate: baseline?.end ?? '' });

  const loading = current.loading || comparison.loading;
  const error = current.error || comparison.error;
  const priceMix = baseline && !loading && !error ? priceMixEffects(current.skus, comparison.skus) : null;
  return { priceMix, loading, error };
}
