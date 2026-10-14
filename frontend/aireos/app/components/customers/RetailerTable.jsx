'use client';

import { retailerLabel } from '@/app/utils/retailerLabel';
import { TABLE_HEADER_CLASS as headerClass } from '@/components/ui/SortHeader';

import ColumnGrid from './ColumnGrid';
import RowActions from './RowActions';
import UsageStatus from './UsageStatus';

/**
 * Retailers listed under one customer (inside its expanded row) or in the
 * "without a customer" card: name, store count, status and a "..." menu.
 * The caller decides the menu items per retailer. Its columns follow the
 * customer table's (ColumnGrid), narrowed by `inset`, how far this table sits
 * inside the customer table's edges.
 *
 * @param {{
 *   retailers: object[],
 *   inset: string,
 *   actionsFor: (retailer: object) => Parameters<typeof RowActions>[0]['actions'],
 * }} props
 */
export default function RetailerTable({ retailers, inset, actionsFor }) {
  return (
    <div className="overflow-x-auto rounded-md border border-lavander bg-white">
      <table className="w-full min-w-[36rem] table-fixed whitespace-nowrap text-left text-sm text-deep-violet-blue [&_td]:align-middle [&_th]:align-middle">
        <ColumnGrid inset={inset} />
        <thead>
          <tr className="h-9 bg-cream/60 [&>th]:shadow-[inset_0_-1px_0_var(--color-lavander)]">
            <th scope="col" className={headerClass}>Retailer</th>
            <th scope="col" className={headerClass}>Stores</th>
            <th scope="col" className={headerClass}>Status</th>
            <th scope="col" className="px-2 py-2">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
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
        </tbody>
      </table>
    </div>
  );
}
