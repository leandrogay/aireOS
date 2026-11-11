'use client';

import { Check, Eye, Pencil } from 'lucide-react';

import ExpandableRow from '@/components/ui/ExpandableRow';
import MobileRecordCard from '@/components/ui/MobileRecordCard';
import RowActions from '@/components/ui/RowActions';
import StatusPill from '@/components/ui/StatusPill';
import TableGrid, { ACTIONS_COLUMN, EXPANDED_ROW_INSET } from '@/components/ui/TableGrid';
import useExpandedRows from '@/hooks/useExpandedRows';
import { formatDateTime } from '@/lib/formatDate';
import { customerLabel } from '@/app/utils/retailerLabel';
import { monthText } from '@/app/utils/promoUpliftCalc';
import {
  anchorLabel,
  anchorSourceLabel,
  recommendedAnchorLabel,
  sourceTone,
  upcomingAnchorText,
} from '@/app/utils/promoUpliftSettings';
import { cn } from '@/lib/utils';

// One column grid for the customer table and each range table under it, so
// they line up (as on the Customers page). Only the first label differs.
function columns(firstLabel) {
  return [
    { key: 'name', label: firstLabel, width: '13rem' },
    { key: 'anchor', label: 'Anchor' },
    { key: 'source', label: 'Source', width: '12rem' },
    { key: 'recommended', label: 'Recommended now' },
    { key: 'changed', label: 'Last changed', width: '10rem' },
    ACTIONS_COLUMN,
  ];
}

const CUSTOMER_COLUMNS = columns('Customer');
const RANGE_COLUMNS = columns('SKU range');

const tdClass = 'px-4 py-2.5';
const subClass = 'block text-xs text-deep-violet-blue/50';

/**
 * Every customer's anchor (its ordinary-month mechanic and discount),
 * opening to its SKU ranges' own, and beside each what the data recommends
 * now. The anchor shown is this month's; its next change (adopted,
 * overwritten or projected from official promotions) is the second line.
 * A range row, or View details in a "..." menu, opens PromoAnchorDetails.
 * The fallback for targets with nothing saved is its own line under the
 * table (PromoUpliftSettingsView), not a row.
 *
 * Targets passed up are { key, customerId, skuRange, name, anchorPct, row }:
 * skuRange null for a whole customer.
 *
 * @param {object} props
 * @param {{ customers: object[], window_months: number }} props.anchors from getPromoAnchors
 * @param {string | null} props.editingKey the target key being edited
 * @param {boolean} props.readOnly sample values: view only
 * @param {(target: object) => void} props.onView
 * @param {(target: object) => void} props.onEdit overwrite with a mechanic (PromoAnchorOverwriteForm)
 * @param {(target: object) => void} props.onAdopt save the recommendation as the anchor
 */
export default function PromoAnchorTable({ anchors, editingKey, readOnly, onView, onEdit, onAdopt }) {
  const windowMonths = anchors.window_months;
  const expanded = useExpandedRows();

  function rowActions(target) {
    const actions = [{ key: 'view', label: 'View details', icon: Eye, onSelect: () => onView(target) }];
    if (readOnly) return actions;
    if (target.row?.recommendation_differs) {
      actions.push({ key: 'adopt', label: 'Adopt recommended', icon: Check, onSelect: () => onAdopt(target) });
    }
    actions.push({
      key: 'edit',
      label: 'Overwrite anchor',
      icon: Pencil,
      onSelect: () => onEdit(target),
      disabledReason: editingKey === target.key ? 'Editing now' : undefined,
    });
    return actions;
  }

  function cells(row) {
    const upcoming = upcomingAnchorText(row, monthText);
    return (
      <>
        <td className={cn(tdClass, 'truncate font-medium')} title={upcoming ? `${anchorLabel(row)} · ${upcoming}` : anchorLabel(row)}>
          {anchorLabel(row)}
          {upcoming ? <span className={cn(subClass, 'font-normal')}>{upcoming}</span> : null}
        </td>
        <td className={cn(tdClass, 'whitespace-nowrap')}>
          <StatusPill tone={sourceTone(row.source)}>{anchorSourceLabel(row.source)}</StatusPill>
        </td>
        <td className={cn(tdClass, 'truncate')} title={recommendedAnchorLabel(row, windowMonths)}>
          <span className={row.recommendation_differs ? 'text-amber-700' : 'text-deep-violet-blue/70'}>
            {recommendedAnchorLabel(row, windowMonths)}
          </span>
        </td>
        <td className={tdClass}>{row.changed_at ? formatDateTime(row.changed_at) : '—'}</td>
      </>
    );
  }

  function customerTarget(customer) {
    return {
      key: String(customer.customer_id),
      customerId: customer.customer_id,
      skuRange: null,
      name: customerLabel(customer.customer_name),
      anchorPct: customer.anchor_pct,
      row: customer,
    };
  }

  function rangeTarget(customer, range) {
    return {
      key: `${customer.customer_id}:${range.sku_range}`,
      customerId: customer.customer_id,
      skuRange: range.sku_range,
      name: `${customerLabel(customer.customer_name)} · ${range.sku_range}`,
      anchorPct: range.anchor_pct,
      row: range,
    };
  }

  // Phone width: one card per customer with its ranges listed inside, as
  // DohSettingsTable does; the table from sm up.
  const cards = (
    <div className="grid min-w-0 gap-2 sm:hidden">
      {anchors.customers.map((customer) => {
        const target = customerTarget(customer);
        const upcoming = upcomingAnchorText(customer, monthText);
        return (
          <MobileRecordCard
            key={target.key}
            title={target.name}
            badge={<StatusPill tone={sourceTone(customer.source)}>{anchorSourceLabel(customer.source)}</StatusPill>}
            actions={<RowActions label={`Actions for ${target.name}`} actions={rowActions(target)} />}
            fields={[
              { label: 'Anchor', value: upcoming ? <>{anchorLabel(customer)}<span className={subClass}>{upcoming}</span></> : anchorLabel(customer) },
              { label: 'Recommended now', value: recommendedAnchorLabel(customer, windowMonths) },
            ]}
          >
            {customer.ranges.length ? (
              <ul className="mt-3 grid gap-1 border-t border-lavander/70 pt-2">
                {customer.ranges.map((range) => {
                  const item = rangeTarget(customer, range);
                  return (
                    <li key={item.key} className="flex min-w-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onView(item)}
                        className="min-w-0 flex-1 rounded-md px-1 py-1 text-left text-xs text-deep-violet-blue hover:bg-cream"
                      >
                        <span className="block truncate font-medium">{range.sku_range}</span>
                        <span className="block truncate text-deep-violet-blue/60">
                          {anchorLabel(range)} · {anchorSourceLabel(range.source)}
                        </span>
                      </button>
                      <RowActions label={`Actions for ${item.name}`} actions={rowActions(item)} />
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </MobileRecordCard>
        );
      })}
    </div>
  );

  return (
    <>
      {cards}
      <div className="hidden min-w-0 sm:block">
        <TableGrid variant="nested" columns={CUSTOMER_COLUMNS} minWidth="52rem">
          {anchors.customers.map((customer) => {
            const target = customerTarget(customer);
            const name = target.name;
            const isOpen = expanded.isExpanded(customer.customer_id);
            return (
              <ExpandableRow
                key={target.key}
                columnCount={CUSTOMER_COLUMNS.length}
                isOpen={isOpen}
                onToggle={() => expanded.toggle(customer.customer_id)}
                highlight={editingKey === target.key ? 'editing' : null}
                primary={name}
                title={name}
                toggleLabel={isOpen ? `Hide SKU ranges for ${name}` : `Show SKU ranges for ${name}`}
                actions={<RowActions label={`Actions for ${name}`} actions={rowActions(target)} />}
                details={
                  customer.ranges.length ? (
                    <TableGrid variant="nested" columns={RANGE_COLUMNS} inset={EXPANDED_ROW_INSET} minWidth="50rem">
                      {customer.ranges.map((range) => {
                        const item = rangeTarget(customer, range);
                        return (
                          <tr
                            key={item.key}
                            onClick={() => onView(item)}
                            className={cn(
                              'h-11 cursor-pointer border-b border-lavander/80 last:border-b-0 hover:bg-cream/60',
                              editingKey === item.key && 'bg-lavander/90',
                            )}
                          >
                            <td className={cn(tdClass, 'truncate font-medium')} title={range.sku_range}>{range.sku_range}</td>
                            {cells(range)}
                            <td className="px-2 py-1 text-right" onClick={(event) => event.stopPropagation()}>
                              <RowActions label={`Actions for ${item.name}`} actions={rowActions(item)} />
                            </td>
                          </tr>
                        );
                      })}
                    </TableGrid>
                  ) : (
                    <p className="text-sm text-deep-violet-blue/70">No SKU ranges in the catalogue.</p>
                  )
                }
              >
                {cells(customer)}
              </ExpandableRow>
            );
          })}
        </TableGrid>
      </div>
    </>
  );
}
