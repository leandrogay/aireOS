import Disclosure from '@/components/ui/Disclosure';
import { formatMonthLabel } from '@/app/utils/forecastView';
import { splitForRow } from '@/app/utils/scenarioTier0Split';
import { customerLabel } from '@/app/utils/retailerLabel';

function units(value) {
  return Math.round(value).toLocaleString('en-US');
}

/** The historical anchors and sales months behind each customer × SKU in an Initial month. */
export default function InitialSourceDetails({ rows, index, month }) {
  const entries = rows.filter((row) => row.month_year === month)
    .map((row) => ({ row, split: splitForRow(index, row) })).filter((entry) => entry.split);
  if (!entries.length) return null;
  return (
    <Disclosure variant="link" summary="Customer × SKU source months and anchors">
      <ul className="mt-2 max-h-80 space-y-3 overflow-y-auto pr-2 text-[11px] text-deep-violet-blue/70">
        {entries.map(({ row, split }) => (
          <li key={`${row.customer_id}|${row.sku}`} className="space-y-1 border-t border-lavander pt-2">
            <p className="font-semibold text-deep-violet-blue">{customerLabel(row.customer_name)} · {row.product_name}</p>
            <p>Baseline at the anchor: <b>{units(split.baseline)}</b> · Carried effects: <b>{units(split.carried)}</b></p>
            {[...(split.last_year ? [{ ...split.last_year, kind: 'Same month last year' }] : []),
              ...split.recent.map((source) => ({ ...source, kind: 'Recent average' }))].map((source) => (
              <div key={`${source.kind}|${source.month}`}>
                <p>{source.kind} · {formatMonthLabel(source.month)} · {units(source.units)} cartons
                  {source.anchor ? ` · anchor ${source.anchor.mechanic_label || `${source.anchor.anchor_pct}% off`}` : ''}
                  {' '}· promotion uplift {source.uplift_pct}%</p>
                {Object.keys(source.discount_fallbacks ?? {}).length ? (
                  <p>Rule estimate: historical discount read from promotion text
                    {' '}({[...new Set(Object.values(source.discount_fallbacks))].map((value) => `${value}%`).join(', ')} off).</p>
                ) : null}
              </div>
            ))}
            <p>Rounded parts reconcile to Initial: <b>{units(split.tier0)}</b> cartons.</p>
          </li>
        ))}
      </ul>
    </Disclosure>
  );
}
