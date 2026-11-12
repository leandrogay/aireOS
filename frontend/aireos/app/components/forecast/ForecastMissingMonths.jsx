'use client';

import { customerLabel } from '@/app/utils/retailerLabel';
import {
  MISSING_MONTHS_NONE,
  MISSING_MONTHS_TITLE,
  MISSING_MONTHS_UNAVAILABLE,
  missingMonthsByCustomer,
  missingMonthsLayout,
} from '@/app/utils/forecastHelpText';

const titleClass = 'text-[10px] font-semibold uppercase tracking-wide text-deep-violet-blue/55';
const cardClass = 'rounded-md border border-lavander bg-cream/40 px-2.5 py-1.5';

/** One customer's missing months, as a small card. */
function CustomerCard({ entry }) {
  return (
    <div className={cardClass}>
      <p className="font-medium">{entry.name}</p>
      <p className="leading-relaxed text-deep-violet-blue/75">{entry.months.join(', ')}</p>
    </div>
  );
}

/** Several customers, some missing more than one month: one row each. */
function MissingTable({ entries }) {
  return (
    <div className="overflow-hidden rounded-md border border-lavander">
      <table className="w-full text-left">
        <thead className="bg-cream/60 text-deep-violet-blue/60">
          <tr>
            <th scope="col" className="px-2.5 py-1 font-medium">Customer</th>
            <th scope="col" className="px-2.5 py-1 font-medium">Months not sent</th>
            <th scope="col" className="px-2.5 py-1 text-right font-medium">Count</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.key} className="border-t border-lavander align-top">
              <th scope="row" className="px-2.5 py-1 font-medium">{entry.name}</th>
              <td className="px-2.5 py-1 leading-relaxed text-deep-violet-blue/75">{entry.months.join(', ')}</td>
              <td className="px-2.5 py-1 text-right tabular-nums">{entry.months.length}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The help panel's list of sales files each customer hasn't sent, for every
 * customer and all history (hooks/useForecastMissingMonths, worked out by the
 * backend). One card per customer, or a small table when several customers
 * are missing several months (forecastHelpText.missingMonthsLayout).
 *
 * @param {{ data: { customers: object[], available: boolean }, loading: boolean }} props
 */
export default function ForecastMissingMonths({ data, loading }) {
  const entries = missingMonthsByCustomer(data.customers, customerLabel);
  const layout = missingMonthsLayout(entries);

  let body;
  if (loading) body = <p className="text-deep-violet-blue/60">Loading…</p>;
  else if (!data.available) body = <p className="text-deep-violet-blue/60">{MISSING_MONTHS_UNAVAILABLE}</p>;
  else if (layout === 'none') body = <p className="text-deep-violet-blue/60">{MISSING_MONTHS_NONE}</p>;
  else if (layout === 'table') body = <MissingTable entries={entries} />;
  else {
    body = (
      <div className="space-y-1.5">
        {entries.map((entry) => (
          <CustomerCard key={entry.key} entry={entry} />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <p className={titleClass}>{MISSING_MONTHS_TITLE}</p>
      {body}
    </div>
  );
}
