'use client';

import { Archive, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';

import MobileRecordCard from '@/components/ui/MobileRecordCard';
import RowActions from '@/components/ui/RowActions';
import SortHeader, { TABLE_HEADER_CLASS } from '@/components/ui/SortHeader';
import StatusBadge from '@/components/ui/StatusBadge';
import StatusPill from '@/components/ui/StatusPill';
import TableGrid from '@/components/ui/TableGrid';
import TableSearch from '@/components/ui/TableSearch';
import { nextSort } from '@/app/utils/tableView';

import { NotMigrated, Panel, Section, Variant, WhichToUse } from './GalleryParts';
import TableCardDemo from './TableCardDemo';
import TableListDemo from './TableListDemo';
import { GUIDE, LEAVE_AS_IS, NOT_MIGRATED } from './tableGalleryData';

// A living reference for the table kit; see app/testing/page.js. The live
// tables are in TableListDemo (DataTable and its rows) and TableCardDemo
// (titled cards); the sample rows and reference tables in tableGalleryData.

const PILL_TONES = [
  ['success', 'Active'],
  ['info', 'Upcoming'],
  ['warning', 'Under review'],
  ['danger', 'Failed'],
  ['muted', 'Past'],
];

const BADGE_TONES = [
  ['ready', 'Ready'],
  ['busy', 'Processing'],
  ['review', 'Needs review'],
  ['duplicate', 'Duplicate'],
  ['failed', 'Rejected'],
  ['neutral', 'Waiting'],
];

const ROW_ACTIONS = [
  { key: 'edit', label: 'Edit', icon: Pencil, onSelect: () => {} },
  { key: 'archive', label: 'Archive', icon: Archive, onSelect: () => {}, disabledReason: 'Already archived' },
  { key: 'delete', label: 'Delete', icon: Trash2, destructive: true, onSelect: () => {} },
];

const SIDE_BY_SIDE_ROWS = [
  { sku: 'AIRE-TP-M-48', units: 1240 },
  { sku: 'AIRE-PT-L-36', units: 860 },
];

const SIDE_BY_SIDE_COLUMNS = [
  { key: 'sku', label: 'SKU' },
  { key: 'units', label: 'Units sold', width: '7rem', align: 'right' },
];

export default function TableGallery() {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState({ field: 'units', direction: 'desc' });

  return (
    <div>
      <WhichToUse
        rows={GUIDE}
        note="Build new tables on these rather than on a raw <table>. Promotions and Customers are the reference for the list table (Recent uploads for one with a title); Settings (promotion uplifts) and Inventory for the titled card."
      >
        Every column is declared once (a <span className="font-mono">columns.js</span> per feature):{' '}
        <span className="font-mono">width</span> fixes it, <span className="font-mono">sortField</span> makes its header
        sort, <span className="font-mono">hideBelow</span> drops it on narrow screens (the rows&apos; cells take{' '}
        <span className="font-mono">hideClass(column)</span>) and <span className="font-mono">align: &apos;right&apos;</span>{' '}
        is for numbers, with <span className="font-mono">tabular-nums</span> on the cells. Paging, sorting and search
        use the pure helpers in <span className="font-mono">app/utils/tableView.js</span>.
      </WhichToUse>

      <Panel
        title="List table — PaginatedDataTable"
        note="Search, sort Store or Units sold, page through, open a row for its SKUs (a nested TableGrid lined up with inset), and use the “…” menu. The first two rows show the editing and new highlights. Switch the state to see first load, refresh, error (Retry) and empty; a search that matches nothing shows the no-matches row. Under 640px wide it turns into MobileRecordCards."
      >
        <TableListDemo />
      </Panel>

      <Panel
        title="Titled table card — TableCard + TableCardHeader"
        note="For a table that sits among other cards and needs its own title. Left: a TableGrid inside, as on the Dashboard SKU ranking and the Forecast monthly values. Right: the Inventory tabs' InventoryTableFrame, a TableGrid whose Month column filters from its header, with paging."
      >
        <TableCardDemo />
      </Panel>

      <Section title="Row parts" note="The pieces a row is built from, on their own.">
        <Variant name="StatusPill tones (a record's status)" props="tone" value={PILL_TONES.map(([tone]) => tone)}>
          <div className="flex flex-wrap gap-1.5">
            {PILL_TONES.map(([tone, label]) => (
              <StatusPill key={tone} tone={tone}>
                {label}
              </StatusPill>
            ))}
          </div>
        </Variant>
        <Variant name="StatusBadge tones (upload states)" props="tone" value={BADGE_TONES.map(([tone]) => tone)}>
          <div className="flex flex-wrap gap-1.5">
            {BADGE_TONES.map(([tone, label]) => (
              <StatusBadge key={tone} tone={tone}>
                {label}
              </StatusBadge>
            ))}
          </div>
        </Variant>
        <Variant name="RowActions, disabled + destructive" props="actions[].disabledReason, .destructive" value="open the menu">
          <RowActions label="Actions for the sample row" actions={ROW_ACTIONS} />
        </Variant>
        <Variant name="TableSearch" props="value, onChange, label, placeholder" value={search}>
          <TableSearch value={search} onChange={setSearch} label="Search the sample" placeholder="Search…" />
        </Variant>
        <Variant name="SortHeader (inactive, active)" props="field, sortField, sortDirection, onSort" value={sort}>
          <table className="w-full">
            <thead className="bg-cream">
              <tr>
                <SortHeader label="SKU" field="sku" sortField={sort.field} sortDirection={sort.direction} onSort={(field) => setSort((current) => nextSort(current, field))} />
                <SortHeader label="Units" field="units" sortField={sort.field} sortDirection={sort.direction} onSort={(field) => setSort((current) => nextSort(current, field))} />
              </tr>
            </thead>
          </table>
        </Variant>
        <div className="sm:col-span-2 lg:col-span-2">
          <Variant name="MobileRecordCard (DataTable mobileContent)" props="title, subtitle, badge, actions, fields" value={null}>
            <MobileRecordCard
              title="FairPrice Tampines"
              subtitle="Fairprice Offline"
              badge={<StatusPill tone="success">Active</StatusPill>}
              actions={<RowActions label="Actions for FairPrice Tampines" actions={ROW_ACTIONS} />}
              fields={[
                { label: 'Format', value: 'Hypermarket' },
                { label: 'Units sold', value: '4,215' },
              ]}
            />
          </Variant>
        </div>
      </Section>

      <NotMigrated rows={NOT_MIGRATED} leaveAsIs={LEAVE_AS_IS}>
        <div className="sm:col-span-2 lg:col-span-2">
          <Variant name="Old: hand-rolled <table> (SKU ranking)" props="own classes per file" value={null}>
            <table className="w-full text-left text-sm text-deep-violet-blue">
              <thead className="bg-cream">
                <tr className="border-b border-lavander">
                  <th className={TABLE_HEADER_CLASS}>SKU</th>
                  <th className={`${TABLE_HEADER_CLASS} text-right`}>Units sold</th>
                </tr>
              </thead>
              <tbody>
                {SIDE_BY_SIDE_ROWS.map((row) => (
                  <tr key={row.sku} className="border-b border-lavander/80">
                    <td className="px-4 py-2.5">{row.sku}</td>
                    <td className="px-4 py-2.5 text-right">{row.units}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Variant>
        </div>
        <div className="sm:col-span-2 lg:col-span-2">
          <Variant name="New: TableGrid" props={'columns, variant="nested"'} value={null}>
            <TableGrid variant="nested" columns={SIDE_BY_SIDE_COLUMNS}>
              {SIDE_BY_SIDE_ROWS.map((row) => (
                <tr key={row.sku} className="h-10 border-b border-lavander/80 last:border-b-0">
                  <td className="px-4 py-2 font-medium">{row.sku}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{row.units.toLocaleString('en-SG')}</td>
                </tr>
              ))}
            </TableGrid>
          </Variant>
        </div>
      </NotMigrated>
    </div>
  );
}
