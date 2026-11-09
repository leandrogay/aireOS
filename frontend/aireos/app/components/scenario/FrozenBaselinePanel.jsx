'use client';

import { LockKeyhole } from 'lucide-react';

import { cn } from '@/lib/utils';
import LineToggle from '@/components/ui/LineToggle';
import { formatMonthLabel } from '@/app/utils/forecastView';
import { discountSourceLabel } from '@/app/utils/scenarioBreakdown';

function units(value) {
  if (value == null || value === '') return 'Not available';
  return Math.round(Number(value) || 0).toLocaleString('en-US');
}

function signedUnits(value) {
  const number = Number(value) || 0;
  return `${number < 0 ? '−' : '+'}${units(Math.abs(number))}`;
}

function StatusBadge({ children, tone = 'muted' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold',
        tone === 'frozen' && 'bg-lavander text-deep-violet-blue',
        tone === 'fallback' && 'bg-amber-50 text-amber-800',
        tone === 'scenario' && 'bg-scenario-soft text-scenario-ink',
        tone === 'muted' && 'bg-cream text-deep-violet-blue/60'
      )}
    >
      {children}
    </span>
  );
}

function Fact({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-lavander/70 py-1.5 last:border-0">
      <dt className="text-deep-violet-blue/65">{label}</dt>
      <dd className="font-semibold tabular-nums text-deep-violet-blue">{value}</dd>
    </div>
  );
}

/**
 * Read-only explanation of the selected month's Tier 0 baseline and the
 * editable scenario contributions already calculated by scenarioEngine.
 *
 * @param {{ rows: object[], monthItems: Map, bakedIn: object | null, compositionVisible: object, onToggleComposition: (key: string) => void }} props
 */
export default function FrozenBaselinePanel({
  rows,
  monthItems: scenarioMonthItems,
  bakedIn,
  compositionVisible,
  onToggleComposition,
}) {
  const forecastRow = rows.find((row) => row.forecast_current != null) ?? rows[0];
  if (!forecastRow) return null;

  const months = rows.filter((row) => row.forecast_current != null);
  const selectedMonth = forecastRow.month_year;
  const selectedItems = scenarioMonthItems.get(selectedMonth) ?? [];
  const adjustments = selectedItems.reduce(
    (totals, item) => ({
      deltaUnits: totals.deltaUnits + item.deltaUnits,
      blocks: totals.blocks + (item.source === 'blocks' ? item.deltaUnits : 0),
      promotions: totals.promotions + (item.source === 'promotions' ? item.deltaUnits : 0),
    }),
    { deltaUnits: 0, blocks: 0, promotions: 0 }
  );
  const blocks = adjustments.blocks;
  const promotions = adjustments.promotions;
  const simulated = Number(forecastRow.forecast_current ?? 0) + adjustments.deltaUnits;
  const isFrozen = Boolean(forecastRow.tier0_latest_month);
  const snapshotFrozen = bakedIn?.frozen === true;

  return (
    <div className="space-y-3" aria-label="Forecast breakdown">
      <div className="flex items-center gap-1.5">
        <LockKeyhole className="size-3.5 text-deep-violet-blue/60" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-deep-violet-blue">Forecast breakdown</h2>
      </div>
      <p className="text-[11px] text-deep-violet-blue/60">
        Tier 0 and historical discount mechanics are read-only. Edit the assumptions in the other tabs.
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusBadge tone={isFrozen ? 'frozen' : 'fallback'}>
          {isFrozen ? 'Tier 0 frozen' : 'Tier 0 fallback'}
        </StatusBadge>
        <StatusBadge tone={snapshotFrozen ? 'frozen' : 'fallback'}>
          {snapshotFrozen ? 'Promotion snapshot frozen' : 'Promotion snapshot not frozen yet'}
        </StatusBadge>
        {months.length > 1 ? <span className="text-[11px] text-deep-violet-blue/50">Showing {formatMonthLabel(selectedMonth)}</span> : null}
      </div>

      <LineToggle
        label="Shaded layers"
        visible={compositionVisible}
        onToggle={onToggleComposition}
        series={[
          { key: 'tier0Layer', label: 'Tier 0 base', color: '#3A4369', shape: 'square' },
          { key: 'blocksLayer', label: 'Blocks', color: '#8E7CC3', shape: 'square' },
          { key: 'promotionsLayer', label: 'Promotions', color: '#D68B6D', shape: 'square' },
        ]}
        hints={{
          tier0Layer: 'The frozen Tier 0 forecast is the baseline. It cannot be edited here.',
          blocksLayer: 'Building block deltas added to Tier 0.',
          promotionsLayer: 'Planned promotion deltas added to the block-adjusted forecast.',
        }}
      />

      <div className="grid gap-3">
        <div className="rounded border border-lavander/80 bg-lavander/20 p-2.5">
          <p className="text-[10px] font-bold uppercase tracking-wide text-deep-violet-blue/55">
            Frozen forecast context
          </p>
          <dl className="mt-1 text-xs">
            <Fact label="Initial yearly forecast" value={units(forecastRow.forecast_initial)} />
            <Fact label="Previous forecast" value={units(forecastRow.forecast_previous)} />
            <Fact label="Current Tier 0 forecast" value={units(forecastRow.forecast_current)} />
            <Fact label="Last year actual" value={units(forecastRow.tier0_ly_cartons)} />
            <Fact label="Run-rate" value={units(forecastRow.tier0_run_rate)} />
            <Fact label="Base method" value={forecastRow.tier0_base_method ?? 'Current forecast'} />
          </dl>
        </div>

          <div className="rounded border border-scenario/20 bg-scenario-soft/40 p-2.5">
            <p className="text-[10px] font-bold uppercase tracking-wide text-scenario-ink/70">Your scenario adjustments</p>
            <dl className="mt-1 text-xs">
              <Fact label="Building blocks" value={signedUnits(blocks)} />
              <Fact label="Planned promotions" value={signedUnits(promotions)} />
              <Fact label="Simulated forecast" value={units(simulated)} />
            </dl>
          </div>

          <div className="rounded border border-lavander/80 bg-cream/50 p-2.5">
            <p className="text-[10px] font-bold uppercase tracking-wide text-deep-violet-blue/55">Baked-in discount context</p>
            <div className="mt-1 space-y-1.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-deep-violet-blue/65">Last year</span>
                <span className="font-semibold">{bakedIn?.same_month_last_year?.mechanic ?? 'Not available'}</span>
              </div>
              {(bakedIn?.recent_months ?? []).map((item) => (
                <div key={item.month} className="flex items-center justify-between gap-2">
                  <span className="text-deep-violet-blue/65">{formatMonthLabel(item.month)}</span>
                  <span className="text-right">
                    <span className="font-semibold">{item.mechanic ?? '—'}</span>{' '}
                    <span className="text-[10px] text-deep-violet-blue/55">· {discountSourceLabel(item.source)}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
      </div>
    </div>
  );
}
