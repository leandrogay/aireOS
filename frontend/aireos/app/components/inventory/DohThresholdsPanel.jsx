'use client';

import { Fragment, useState } from 'react';

import { Button } from '@/components/ui/button';
import useDohThresholds from '@/hooks/useDohThresholds';
import { getDohHistory, resetDohThreshold } from '@/app/services/inventoryApi';
import { formatDoh, formatTimestamp } from '@/app/utils/inventoryForm';

import DohThresholdForm from './DohThresholdForm';
import { cardClass } from './formStyles';

const thClass = 'bg-lavander px-2 py-1.5 text-left text-xs font-semibold text-deep-violet-blue';
const tdClass = 'px-2 py-1.5 text-sm text-deep-violet-blue';

/**
 * DOH thresholds for every customer, a form to change them, and per-customer
 * history and reset. A customer with no target of its own is badged "Global
 * Default" (target 30, min/max ±5). Each change closes the old target and opens
 * a new one in the database, so History lists old value, new value and when.
 *
 * @param {object} props
 * @param {Array<{ customer_id: number, customer_name: string }>} props.customers
 * @param {number} props.refreshKey
 * @param {() => void} props.onChanged called after a save or reset so other views refetch
 * @param {(type: 'success' | 'error', message: string) => void} props.onNotify
 */
export default function DohThresholdsPanel({ customers, refreshKey, onChanged, onNotify }) {
  const { data, loading, error } = useDohThresholds({ refreshKey });
  const [historyFor, setHistoryFor] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyError, setHistoryError] = useState('');
  const [confirmingReset, setConfirmingReset] = useState(null);

  async function toggleHistory(customerId) {
    if (historyFor === customerId) {
      setHistoryFor(null);
      return;
    }
    setHistoryFor(customerId);
    setHistory([]);
    setHistoryError('');
    try {
      setHistory(await getDohHistory(customerId));
    } catch (err) {
      setHistoryError(err.message);
    }
  }

  async function handleReset(customerId) {
    try {
      await resetDohThreshold(customerId);
      setConfirmingReset(null);
      setHistoryFor(null);
      onChanged();
      onNotify('success', 'Threshold reset to the global default');
    } catch (err) {
      onNotify('error', err.message);
    }
  }

  function handleSaved(message) {
    setHistoryFor(null);
    onChanged();
    onNotify('success', message);
  }

  return (
    <div className="grid gap-2">
      <section className={cardClass}>
        <h2 className="mb-2 text-sm font-medium text-deep-violet-blue">Current thresholds</h2>
        {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
        {loading && data.length === 0 ? (
          <p className="text-sm text-deep-violet-blue/70">Loading thresholds…</p>
        ) : (
          <div className="overflow-auto rounded-md border border-lavander">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={thClass}>Customer</th>
                  <th className={thClass}>Min DOH</th>
                  <th className={thClass}>Target DOH</th>
                  <th className={thClass}>Max DOH</th>
                  <th className={thClass}>Last updated</th>
                  <th className={thClass}>Alerts</th>
                  <th className={thClass} />
                </tr>
              </thead>
              <tbody>
                {data.map((row) => (
                  <Fragment key={row.customer_id}>
                    <tr className="border-t border-lavander">
                      <td className={tdClass}>{row.customer_name}</td>
                      <td className={tdClass}>{formatDoh(row.min_doh)}</td>
                      <td className={tdClass}>
                        {formatDoh(row.target_doh)}
                        {row.is_global_default && (
                          <span className="ml-2 rounded-full border border-violet bg-lavander px-2 py-0.5 text-[11px]">
                            Global Default
                          </span>
                        )}
                      </td>
                      <td className={tdClass}>{formatDoh(row.max_doh)}</td>
                      <td className={tdClass}>{formatTimestamp(row.last_updated)}</td>
                      <td className={tdClass} title="Alert settings are not stored yet">—</td>
                      <td className={tdClass}>
                        <div className="flex gap-1">
                          <Button variant="outline" size="xs" onClick={() => toggleHistory(row.customer_id)}>
                            {historyFor === row.customer_id ? 'Hide history' : 'History'}
                          </Button>
                          {!row.is_global_default &&
                            (confirmingReset === row.customer_id ? (
                              <>
                                <Button variant="destructive" size="xs" onClick={() => handleReset(row.customer_id)}>
                                  Confirm reset
                                </Button>
                                <Button variant="outline" size="xs" onClick={() => setConfirmingReset(null)}>
                                  Cancel
                                </Button>
                              </>
                            ) : (
                              <Button variant="outline" size="xs" onClick={() => setConfirmingReset(row.customer_id)}>
                                Reset to default
                              </Button>
                            ))}
                        </div>
                      </td>
                    </tr>
                    {historyFor === row.customer_id && (
                      <tr className="border-t border-lavander bg-cream/50">
                        <td colSpan={7} className="px-3 py-2">
                          <ThresholdHistory history={history} error={historyError} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-deep-violet-blue/60">
          Min and max are the target −5 / +5 days. Alert settings are not available yet.
        </p>
      </section>

      <section className={cardClass}>
        <h2 className="mb-2 text-sm font-medium text-deep-violet-blue">Configure thresholds</h2>
        <DohThresholdForm customers={customers} onSaved={handleSaved} />
      </section>
    </div>
  );
}

/**
 * Old value → new value for one customer, newest change first.
 */
function ThresholdHistory({ history, error }) {
  if (error) return <p className="text-sm text-red-600" role="alert">{error}</p>;
  if (history.length === 0) return <p className="text-sm text-deep-violet-blue/70">No history.</p>;

  return (
    <ul className="grid gap-1 text-sm text-deep-violet-blue">
      {history.map((entry) => (
        <li key={`${entry.customer_id}-${entry.effective_from}`}>
          <strong>{formatDoh(entry.target_doh)}</strong> from {entry.effective_from}
          {entry.effective_to ? ` to ${entry.effective_to}` : ' (current)'}
          {entry.previous_target_doh !== null && (
            <span className="text-deep-violet-blue/70">
              {' '}
              — replaced {formatDoh(entry.previous_target_doh)} (since {entry.previous_effective_from})
            </span>
          )}
          <span className="text-deep-violet-blue/60"> · recorded {formatTimestamp(entry.recorded_at)}</span>
        </li>
      ))}
    </ul>
  );
}
