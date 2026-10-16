'use client';

import RowActions from '@/components/ui/RowActions';
import TableGrid from '@/components/ui/TableGrid';
import { retailerLabel } from '@/app/utils/retailerLabel';

import { RETAILER_COLUMNS } from './columns';
import UsageStatus from './UsageStatus';

/**
 * Retailers listed under one customer (inside its expanded row) or in the
 * "without a customer" card: name, store count, status and a "..." menu.
 * The caller decides the menu items per retailer. Its columns follow the
 * customer table's (columns.js), narrowed by `inset`, how far this table
 * sits inside the customer table's edges.
 *
 * @param {{
 *   retailers: object[],
 *   inset: string,
 *   actionsFor: (retailer: object) => Parameters<typeof RowActions>[0]['actions'],
 * }} props
 */
export default function RetailerTable({ retailers, inset, actionsFor }) {
  return (
    <TableGrid variant="nested" columns={RETAILER_COLUMNS} inset={inset} minWidth="36rem">
      {retailers.map((retailer) => (
        <tr key={retailer.retailer_id} className="h-11 border-b border-lavander/80 last:border-b-0">
          <td className="truncate px-4 py-2 font-medium" title={retailer.retailer_name}>
            {retailerLabel(retailer.retailer_name)}
            <span className="ml-2 text-xs font-normal text-deep-violet-blue/50">{retailer.retailer_name}</span>
          </td>
          <td className="px-4 py-2 tabular-nums">{retailer.store_count}</td>
          <td className="px-4 py-2">
            <UsageStatus inUse={retailer.in_use} />
          </td>
          <td className="px-2 py-1 text-right">
            <RowActions
              label={`Actions for retailer ${retailerLabel(retailer.retailer_name)}`}
              actions={actionsFor(retailer)}
            />
          </td>
        </tr>
      ))}
    </TableGrid>
  );
}
