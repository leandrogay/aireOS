'use client';

import { Check, Eye, Pencil } from 'lucide-react';

import ExpandableRow from '@/components/ui/ExpandableRow';
import RowActions from '@/components/ui/RowActions';
import StatusPill from '@/components/ui/StatusPill';
import TableGrid, { ACTIONS_COLUMN, EXPANDED_ROW_INSET } from '@/components/ui/TableGrid';
import useExpandedRows from '@/hooks/useExpandedRows';
import { formatDateTime } from '@/lib/formatDate';
import { customerLabel } from '@/app/utils/retailerLabel';
import { anchorLabel, anchorSourceLabel, recommendedAnchorLabel, sourceTone } from '@/app/utils/promoUpliftSettings';
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


/**
 * Every customer's anchor (its ordinary-month mechanic and discount),
 * opening to its SKU ranges' own, with the all-customers fallback as the
 * last row, and beside each what the data recommends now. Anchors only
 * change when someone adopts a recommendation, or types a discount where
 * there are too few moments to recommend from. A range row, or View
 * details in a "..." menu, opens PromoAnchorDetails.
 *
 * Targets passed up are { key, customerId, skuRange, name, anchorPct, row }:
 * skuRange null for a whole customer, customerId null for all customers.
 *
 * @param {object} props
 * @param {{ default_anchor_pct: number, customers: object[] }} props.anchors from getPromoAnchors
 * @param {string | null} props.editingKey the target key being edited
 * @param {boolean} props.readOnly sample values: view only
 * @param {(target: object) => void} props.onView
 * @param {(target: object) => void} props.onEdit type a discount
 * @param {(target: object) => void} props.onAdopt save the recommendation as the anchor
 */
export default function PromoAnchorTable({ anchors, editingKey, readOnly, onView, onEdit, onAdopt }) {
  const windowMonths = anchors.window_months;
  const expanded = useExpandedRows();
  const defaultTarget = {
    key: 'default',
    customerId: null,
    skuRange: null,
    name: 'All customers',
    anchorPct: anchors.default_anchor_pct,
    row: null,
  };

  function rowActions(target) {
    const actions = [{ key: 'view', label: 'View details', icon: Eye, onSelect: () => onView(target) }];
    if (readOnly) return actions;
    if (target.row?.recommendation_differs) {
      actions.push({ key: 'adopt', label: 'Adopt recommended', icon: Check, onSelect: () => onAdopt(target) });
    }
    // The all-customers value has no moments of its own, so it is always typed.
    if (!target.row || target.row.manual_allowed) {
      actions.push({
        key: 'edit',
        label: 'Type a discount',
        icon: Pencil,
        onSelect: () => onEdit(target),
        disabledReason: editingKey === target.key ? 'Editing now' : undefined,
      });
    }
    return actions;
  }

  function cells(row) {
    return (
      <>
        <td className={cn(tdClass, 'truncate font-medium')} title={anchorLabel(row)}>{anchorLabel(row)}</td>
        <td className={cn(tdClass, 'whitespace-nowrap')}>
          <StatusPill tone={sourceTone(row.source)}>{anchorSourceLabel(row.source)}</StatusPill>
        </td>
        <td className={cn(tdClass, 'truncate')} title={recommendedAnchorLabel(row, windowMonths)}>
          <span className={row.recommendation_differs ? 'text-amber-800' : 'text-ink-soft'}>
            {recommendedAnchorLabel(row, windowMonths)}
          </span>
        </td>
        <td className={cn(tdClass, 'tabular-nums')}>{row.changed_at ? formatDateTime(row.changed_at) : '—'}</td>
      </>
    );
  }

  return (
    <TableGrid columns={CUSTOMER_COLUMNS} minWidth="52rem">
      {anchors.customers.map((customer) => {
        const name = customerLabel(customer.customer_name);
        const target = {
          key: String(customer.customer_id),
          customerId: customer.customer_id,
          skuRange: null,
          name,
          anchorPct: customer.anchor_pct,
          row: customer,
        };
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
                    const rangeTarget = {
                      key: `${customer.customer_id}:${range.sku_range}`,
                      customerId: customer.customer_id,
                      skuRange: range.sku_range,
                      name: `${name} · ${range.sku_range}`,
                      anchorPct: range.anchor_pct,
                      row: range,
                    };
                    return (
                      <tr
                        key={rangeTarget.key}
                        onClick={() => onView(rangeTarget)}
                        className={cn(
                          'h-11 cursor-pointer border-b border-lavander/80 last:border-b-0 hover:bg-cream/60',
                          editingKey === rangeTarget.key && 'bg-lavander/90',
                        )}
                      >
                        <td className={cn(tdClass, 'truncate font-medium')} title={range.sku_range}>{range.sku_range}</td>
                        {cells(range)}
                        <td className="px-2 py-1 text-right" onClick={(event) => event.stopPropagation()}>
                          <RowActions label={`Actions for ${rangeTarget.name}`} actions={rowActions(rangeTarget)} />
                        </td>
                      </tr>
                    );
                  })}
                </TableGrid>
              ) : (
                <p className="text-sm text-ink-soft">No SKU ranges in the catalogue.</p>
              )
            }
          >
            {cells(customer)}
          </ExpandableRow>
        );
      })}
      <tr
        onClick={() => onView(defaultTarget)}
        className={cn(
          'h-12 cursor-pointer border-b border-lavander/80 last:border-b-0 hover:bg-cream/50',
          editingKey === 'default' ? 'bg-lavander/90' : 'bg-cream/40',
        )}
      >
        {/* pl-10 lines the name up with the customers' names after their chevrons. */}
        <td className="py-2.5 pl-10 pr-4 font-medium">All customers</td>
        <td className={cn(tdClass, 'font-medium tabular-nums')}>{anchors.default_anchor_pct}% off</td>
        <td className={cn(tdClass, 'text-ink-soft')} colSpan={3}>Fallback</td>
        <td className="px-2 py-1 text-right" onClick={(event) => event.stopPropagation()}>
          <RowActions label="Actions for All customers" actions={rowActions(defaultTarget)} />
        </td>
      </tr>
    </TableGrid>
  );
}
