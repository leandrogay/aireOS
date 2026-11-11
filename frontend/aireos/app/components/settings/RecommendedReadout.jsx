import { formatMomentCounts, recommendedUplift } from '@/app/utils/promoUpliftSettings';
import { formatPct } from '@/app/utils/scenarioPromotions';

/**
 * Moments and Recommended Uplift for one mechanic and scope, shown above the
 * Manual Uplift input (add-value form and details dialog) so the typed value
 * can be weighed against what the data says.
 *
 * @param {object} props
 * @param {{ scope: string, mechanic_key: string, customer_name?: string, sku_range?: string, sku?: string } | null} props.scopeRow null until the scope is fully chosen
 * @param {{ moments: object[], recommendations: object[], recommend_from: number } | null} props.moments from usePromoMoments; null while loading or unavailable
 */
export default function RecommendedReadout({ scopeRow, moments }) {
  let body;
  if (!scopeRow) {
    body = <p className="text-ink-soft">Choose what this value applies to, to see its moments.</p>;
  } else if (!moments) {
    body = <p className="text-ink-soft">Moments are not available.</p>;
  } else if (scopeRow.mechanic_key === 'voucher') {
    body = <p className="text-ink-soft">Vouchers are not measured: only offline sales are, and vouchers matter online.</p>;
  } else {
    const recommended = recommendedUplift(scopeRow, moments);
    body = (
      <>
        <p>
          <span className="text-ink-soft">Moments:</span> {formatMomentCounts(recommended.counts)}
          <span className="mx-2 text-deep-violet-blue/30">·</span>
          <span className="text-ink-soft">Recommended Uplift:</span>{' '}
          <b>{recommended.value != null ? formatPct(recommended.value) : 'none'}</b>
          {recommended.products > 1 ? (
            <span className="text-ink-soft"> (average of {recommended.products} SKUs)</span>
          ) : null}
        </p>
        {recommended.enoughData ? null : (
          <p className="mt-0.5 text-amber-800">
            Needs {moments.recommend_from} moments to recommend. Key in a Manual Uplift if you have a view.
          </p>
        )}
      </>
    );
  }

  return (
    <div className="rounded-md border border-lavander bg-cream/60 px-3 py-2 text-xs text-deep-violet-blue" role="status">
      {body}
    </div>
  );
}
