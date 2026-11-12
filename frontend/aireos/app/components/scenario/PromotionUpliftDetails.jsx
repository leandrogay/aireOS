import Disclosure from '@/components/ui/Disclosure';
import StatusPill from '@/components/ui/StatusPill';
import { levelTone, monthText } from '@/app/utils/promoUpliftCalc';
import { formatPct, sourceLabel } from '@/app/utils/scenarioPromotions';
import { customerLabel } from '@/app/utils/retailerLabel';

/** The expected value and its derivation for each included customer × SKU and period. */
export default function PromotionUpliftDetails({ rows, overridden }) {
  const count = new Set(rows.map((row) => JSON.stringify([row.customer, row.product, row.skuRange]))).size;
  return (
    <Disclosure variant="link" summary={`How expected uplift is calculated · ${count} customer × SKU ${count === 1 ? 'pair' : 'pairs'}`}>
      <ul className="mt-2 max-h-80 space-y-3 overflow-y-auto pr-1 text-[11px] text-deep-violet-blue/70">
        {rows.map((row) => (
          <li key={JSON.stringify([row.customer, row.product, row.skuRange, row.fromMonth])} className="space-y-1 border-t border-lavander pt-2">
            <p className="font-semibold text-deep-violet-blue">
              {customerLabel(row.customer)} · {row.product ?? (row.skuRange ? `Every SKU in ${row.skuRange}` : 'All SKUs')}
            </p>
            <p>{row.skuRange ? `${row.skuRange} · ` : ''}{monthText(row.fromMonth)}
              {row.toMonth !== row.fromMonth ? ` – ${monthText(row.toMonth)}` : ''}</p>
            <p>Expected mechanic uplift: <b className="text-scenario-ink">{formatPct(row.expectedPct)}</b></p>
            {row.level ? (
              <StatusPill tone={levelTone(row.level)}>{row.level === 'placeholder' ? 'Rule estimate' : sourceLabel(row.level)}</StatusPill>
            ) : null}
            {row.lines.length ? row.lines.map((line, index) => <p key={index}>{line}</p>) : (
              <p>The value was copied from Promotion uplift settings. Its detailed calculation was not stored with this promotion.</p>
            )}
            {row.kind === 'saved' && row.lines.length ? <p>Calculation kept with the copied uplift.</p> : null}
            {overridden ? <p>Used instead: <b>{formatPct(row.appliedPct)}</b> (manual override).</p> : null}
          </li>
        ))}
      </ul>
      {!rows.length ? <p className="mt-1 text-[11px] text-deep-violet-blue/60">No applicable customer × SKU pairs.</p> : null}
    </Disclosure>
  );
}
