import { cappedNote } from '@/app/utils/promoUpliftSettings';
import { formatPct } from '@/app/utils/scenarioPromotions';
import { cn } from '@/lib/utils';

/**
 * Before/after of every rule-based uplift, for the anchor and rule dialogs'
 * live previews (rows from anchorPreview or ratePreview). A changed uplift is
 * bold; one the rule pushed past -90..+300 says it was capped.
 *
 * @param {{ rows: Array<{ mechanicKey: string, label: string, before: number, after: number, capped: boolean }> }} props
 */
export default function RulePreviewTable({ rows }) {
  return (
    <div className="overflow-auto rounded-md border border-lavander">
      <table className="w-full text-xs text-deep-violet-blue">
        <thead>
          <tr className="bg-lavander text-left">
            <th className="px-2 py-1 font-semibold">Rule-based mechanic</th>
            <th className="px-2 py-1 text-right font-semibold">Now</th>
            <th className="px-2 py-1 text-right font-semibold">After</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => (
            <tr key={item.mechanicKey} className="border-t border-lavander">
              <td className="px-2 py-1">{item.label}</td>
              <td className="px-2 py-1 text-right tabular-nums">{formatPct(item.before)}</td>
              <td className={cn('px-2 py-1 text-right tabular-nums', item.after !== item.before && 'font-semibold')}>
                {formatPct(item.after)}
                {item.capped ? (
                  <span className="block text-[10px] font-normal text-amber-800">{cappedNote(item.after)}</span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
