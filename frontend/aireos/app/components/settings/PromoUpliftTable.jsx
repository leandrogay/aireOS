'use client';

import { Eye, Pencil, RotateCcw } from 'lucide-react';

import InfoTooltip from '@/components/ui/InfoTooltip';
import RowActions from '@/components/ui/RowActions';
import StatusPill from '@/components/ui/StatusPill';
import TableGrid, { ACTIONS_COLUMN } from '@/components/ui/TableGrid';
import {
  customerColumn,
  formatMomentCounts,
  manualUplift,
  recommendedUplift,
  scopeLabel,
  skuColumn,
} from '@/app/utils/promoUpliftSettings';
import { formatMonthLabel } from '@/app/utils/forecastView';
import { formatPct } from '@/app/utils/scenarioPromotions';
import { cn } from '@/lib/utils';

function hinted(label, hint) {
  return (
    <span className="inline-flex items-center gap-1">
      {label}
      <InfoTooltip label={`About ${label}`}>{hint}</InfoTooltip>
    </span>
  );
}

const rowClass = 'h-11 cursor-pointer border-b border-lavander/80 last:border-b-0 hover:bg-cream/60';
const tdClass = 'px-4 py-2.5';
const numClass = 'text-right tabular-nums';
const subClass = 'block text-xs text-deep-violet-blue/50';
const emptyCell = <span className="text-deep-violet-blue/40">—</span>;

/**
 * Every uplift value: who it applies to, the Recommended Uplift (measured,
 * else the placeholder), the Manual Uplift and its moments. A row opens its
 * details (PromoUpliftDetails). Learned rows are read-only.
 *
 * @param {object} props
 * @param {object[]} props.rows setting rows, or rows resolved for the filters (filteredUpliftRows)
 * @param {(row: object) => number} props.shownUplift the placeholder (or saved) value for a row
 * @param {{ moments: object[], recommendations: object[], recommend_from: number } | null} props.moments from usePromoMoments
 * @param {Map<string, string>} props.productNames sku -> product name
 * @param {boolean} props.readOnly sample values: view only
 * @param {(row: object, options?: { editing: boolean }) => void} props.onView
 * @param {(row: object) => void} props.onReset
 */
export default function PromoUpliftTable({ rows, shownUplift, moments, productNames, readOnly, onView, onReset }) {
  const recommendFrom = moments?.recommend_from ?? 3;
  const columns = [
    { key: 'mechanic', label: 'Mechanic', width: '10rem' },
    { key: 'customer', label: 'Customer', width: '8rem' },
    { key: 'sku', label: 'SKU' },
    { key: 'discount', label: 'Discount', width: '6rem', align: 'right' },
    {
      key: 'recommended',
      label: hinted(
        'Recommended',
        `The average uplift of the latest ${recommendFrom} moments, against months at the customer and SKU range's most common mechanic. Needs ${recommendFrom} moments; until then, key in a Manual Uplift.`,
      ),
      width: '9rem',
      align: 'right',
    },
    {
      key: 'manual',
      label: hinted('Manual', 'A value keyed in by hand. The Scenario builder uses it where set, otherwise the placeholder shown here in grey.'),
      width: '6.5rem',
      align: 'right',
    },
    {
      key: 'moments',
      label: hinted(
        'Moments',
        'Offline months where this mechanic was the only promotion for the whole month, so its own uplift can be measured. Hover a count for its years.',
      ),
      width: '7.5rem',
      align: 'right',
    },
    {
      key: 'effective',
      label: hinted('Effective date', 'The latest moment behind the Recommended Uplift, so it moves when a new moment changes it.'),
      width: '8.5rem',
    },
    ACTIONS_COLUMN,
  ];

  function rowActions(row) {
    const actions = [{ key: 'view', label: 'View details', icon: Eye, onSelect: () => onView(row) }];
    if (readOnly) return actions;
    const learnedReason = row.source === 'learned' ? 'Set by the forecasting model' : undefined;
    actions.push({
      key: 'edit',
      label: 'Set manual uplift',
      icon: Pencil,
      onSelect: () => onView(row, { editing: true }),
      disabledReason: learnedReason,
    });
    if (row.source !== 'placeholder') {
      actions.push({
        key: 'reset',
        label: row.scope === 'all' ? 'Reset to placeholder' : 'Remove',
        icon: RotateCcw,
        onSelect: () => onReset(row),
        disabledReason: learnedReason,
      });
    }
    return actions;
  }

  return (
    <TableGrid
      variant="nested"
      columns={columns}
      minWidth="66rem"
      emptyState={rows.length === 0 ? 'No uplift values match these filters.' : null}
    >
      {rows.map((row) => {
        // A filtered row shows the customer (x SKU) it was resolved for,
        // not the scope its saved value was set at.
        const shownScope = row.view ?? row;
        const inherited = row.view && row.scope !== 'all' && row.scope !== row.view.scope;
        const recommended = moments ? recommendedUplift(shownScope, moments) : null;
        const manual = manualUplift(row);
        return (
          <tr
            key={row.view ? `${row.id}-${row.view.customer_name}-${row.view.sku ?? ''}` : row.id}
            onClick={() => onView(row)}
            className={rowClass}
          >
            <td className={cn(tdClass, 'truncate font-medium')} title={row.mechanic_label}>{row.mechanic_label}</td>
            <td className={cn(tdClass, 'truncate')}>{customerColumn(shownScope)}</td>
            <td className={cn(tdClass, 'truncate')} title={skuColumn(shownScope, productNames)}>
              {skuColumn(shownScope, productNames)}
            </td>
            <td className={cn(tdClass, numClass)}>
              {row.effective_discount_pct != null ? `${row.effective_discount_pct}%` : '—'}
            </td>
            <td className={cn(tdClass, numClass)}>
              <RecommendedCell row={row} recommended={recommended} recommendFrom={recommendFrom} />
            </td>
            <td className={cn(tdClass, numClass)} title={row.note ?? undefined}>
              <ManualCell row={row} manual={manual} fallback={shownUplift(row)} inherited={inherited} />
            </td>
            <td className={cn(tdClass, numClass)}>
              <MomentsCell row={row} recommended={recommended} />
            </td>
            <td className={tdClass}>{recommended?.latestMonth ? formatMonthLabel(recommended.latestMonth) : emptyCell}</td>
            <td className="px-2 py-1 text-right" onClick={(event) => event.stopPropagation()}>
              <RowActions label={`Actions for ${row.mechanic_label}`} actions={rowActions(row)} />
            </td>
          </tr>
        );
      })}
    </TableGrid>
  );
}

// The value the Scenario builder uses: the one keyed in, else the placeholder
// (or the model's value), greyed so it is not mistaken for one keyed in.
function ManualCell({ row, manual, fallback, inherited }) {
  if (manual != null) {
    return (
      <>
        {formatPct(manual)}
        {inherited ? <span className={subClass}>for {scopeLabel(row)}</span> : null}
      </>
    );
  }
  return (
    <span className="text-deep-violet-blue/50">
      {formatPct(fallback)}
      <span className={subClass}>{row.source === 'learned' ? 'Learned' : 'Placeholder'}</span>
    </span>
  );
}

// No value yet means too few moments, not 0%, so it says so rather than
// showing a dash (or a +0% that could pass for a real value).
function RecommendedCell({ row, recommended, recommendFrom }) {
  if (recommended?.value != null) return formatPct(recommended.value);
  if (!recommended || row.mechanic_key === 'voucher') return emptyCell;
  return (
    <span className="whitespace-nowrap">
      <StatusPill tone="muted">Needs {recommendFrom}+</StatusPill>
    </span>
  );
}

function MomentsCell({ row, recommended }) {
  if (!recommended) return emptyCell;
  // Vouchers matter online and only offline is measured (promo_moment_rules).
  if (row.mechanic_key === 'voucher') return <span className="text-deep-violet-blue/50">Not measured</span>;
  return (
    <span title={recommended.counts.total ? formatMomentCounts(recommended.counts) : undefined}>
      {recommended.counts.total}
    </span>
  );
}
