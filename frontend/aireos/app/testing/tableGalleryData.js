// Sample rows and reference tables for the table kit's gallery
// (TableGallery.jsx). Nothing here is fetched: the stores and their SKUs are
// made up, sized so the list table has more than one page.

import { ACTIONS_COLUMN } from '@/components/ui/TableGrid';
import { matchesSearch } from '@/app/utils/tableView';

// ==== Reference tables =======================================================

// Which component to reach for; keep in step with the components themselves.
export const GUIDE = [
  ['List records with search, sort and paging', 'PaginatedDataTable', 'label, noun, totalCount, shownCount, columns, toolbar, pagination, sort, onSort'],
  ['…a short list that needs no paging', 'DataTable', 'the same, without pagination (footer for anything else)'],
  ['…sharing its page with other sections', 'DataTable / PaginatedDataTable', 'title (a heading before the count; Recent uploads)'],
  ['A row that opens to show more', 'ExpandableRow (+ useExpandedRows)', 'columnCount, isOpen, onToggle, primary, actions, details, highlight'],
  ['The "…" menu at the end of a row', 'RowActions + ACTIONS_COLUMN', 'label, actions[] (icon, onSelect, disabledReason, destructive)'],
  ['A table inside an expanded row or a card', 'TableGrid variant="nested"', 'columns, inset (EXPANDED_ROW_INSET / CARD_INSET), minWidth'],
  ['A titled table among other cards', 'TableCard + TableCardHeader', 'label, header; title, detail, actions'],
  ['Filter a column from its header', 'TableGrid column filter (draws a HeaderCheckboxFilter)', 'filter: { selected, options, onChange }'],
  ['Show a record status in a cell', 'StatusPill', 'tone: success | info | muted | warning | danger'],
  ['Show an upload or processing state', 'StatusBadge', 'tone: ready | failed | review | duplicate | busy | neutral'],
  ['The same list on a phone', 'MobileRecordCard (DataTable mobileContent)', 'title, subtitle, badge, actions, fields'],
];

// Tables that should move to the kit, page by page. Remove a row when its
// page migrates.
export const NOT_MIGRATED = [];

// Tables that look like a list table but aren't one, so they stay as they are.
export const LEAVE_AS_IS = [
  ['Forecast', 'forecast/ForecastYearTotals.jsx', 'Compact report table: one thin row per year under the chart'],
  ['Inventory', 'inventory/SellInComparisonTable.jsx', 'Compact report table, the same style as the year totals'],
  ['Scenario', 'scenario/MonthlyPlanTable.jsx, ScenarioYearComparison.jsx', 'Compact report tables with saved / draft chips'],
  ['Inventory', 'inventory/InventoryQuantityTable.jsx', 'A form: a grid of quantity inputs, not a list of records'],
  ['Inventory', 'inventory/SellInUploadForm.jsx ("Not saved" lines)', 'A short list of skipped lines folded inside an import notice'],
  ['Nomenclatures', 'mappings/FileTop.jsx, OutputPreview.jsx, ColumnGroupDetails.jsx, SkuCodeTable.jsx, StepsEditor.jsx', 'Previews of the example file and editable contract tables, read like the spreadsheet'],
  ['Upload', 'upload/UploadPreview.jsx', 'A few rows of mapped output, read like the spreadsheet'],
  ['Settings', 'settings/PromoAnchorForm.jsx', 'Live preview inside a form'],
  ['Dashboard, Scenario, Assistant', 'dashboard/ComparisonTooltip.jsx, scenario/MechanicLookupPopover.jsx, assistant/AssistantMessage.jsx', 'Small tables inside a tooltip, popover or chat message'],
];

// ==== List table sample ======================================================

// Store, Retailer and Format keep their widths in the nested SKU table below
// (SKU, Range, Pack) and Status + Actions (8rem + 4.5rem) match its Share
// column, so the two tables' columns line up when a row is open.
export const STORE_COLUMNS = [
  { key: 'name', label: 'Store', width: '16rem', sortField: 'name' },
  { key: 'retailer', label: 'Retailer', width: '10rem', hideBelow: 'md' },
  { key: 'format', label: 'Format', hideBelow: 'lg' },
  { key: 'units', label: 'Units sold', width: '8rem', align: 'right', sortField: 'units' },
  { key: 'status', label: 'Status', width: '8rem' },
  ACTIONS_COLUMN,
];

export const STORE_SKU_COLUMNS = [
  { key: 'sku', label: 'SKU', width: '16rem' },
  { key: 'range', label: 'Range', width: '10rem', hideBelow: 'md' },
  { key: 'pack', label: 'Pack', hideBelow: 'lg' },
  { key: 'units', label: 'Units sold', width: '8rem', align: 'right' },
  { key: 'share', label: 'Share of store', width: '12.5rem', align: 'right' },
];

// Status → StatusPill tone, as each feature maps its own states.
export const STORE_STATUS = {
  active: { label: 'Active', tone: 'success' },
  opening: { label: 'Opening soon', tone: 'info' },
  review: { label: 'Under review', tone: 'warning' },
  closed: { label: 'Closed', tone: 'muted' },
};
const STATUS_ORDER = ['active', 'active', 'opening', 'active', 'review', 'closed'];

const AREAS = [
  'Ang Mo Kio', 'Bedok', 'Bishan', 'Bukit Batok', 'Bukit Panjang', 'Choa Chu Kang', 'Clementi', 'Geylang',
  'Hougang', 'Jurong East', 'Kallang', 'Marine Parade', 'Novena', 'Pasir Ris', 'Punggol', 'Queenstown',
  'Sembawang', 'Sengkang', 'Serangoon', 'Tampines', 'Toa Payoh', 'Woodlands', 'Yishun',
];
const FORMATS = ['Hypermarket', 'Supermarket', 'Convenience'];
const SKUS = [
  { sku: 'AIRE-TP-M-48', range: 'Tape', pack: 'M, 48 pcs' },
  { sku: 'AIRE-PT-L-36', range: 'Pants', pack: 'L, 36 pcs' },
  { sku: 'AIRE-PT-XL-32', range: 'Pants', pack: 'XL, 32 pcs' },
];

function storeSkus(index, units) {
  // Two or three SKUs per store, splitting its units 50 / 30 / 20.
  const shares = index % 2 === 0 ? [0.5, 0.3, 0.2] : [0.6, 0.4];
  return shares.map((share, skuIndex) => ({ ...SKUS[skuIndex], units: Math.round(units * share), share }));
}

export const SAMPLE_STORES = AREAS.map((area, index) => {
  const units = ((index * 7919) % 4800) + 120;
  return {
    id: index + 1,
    name: `FairPrice ${area}`,
    retailer: index % 5 === 4 ? 'Fairprice Online' : 'Fairprice Offline',
    format: FORMATS[index % FORMATS.length],
    units,
    status: STATUS_ORDER[index % STATUS_ORDER.length],
    skus: storeSkus(index, units),
  };
});

/**
 * The stores matching `query`, sorted by `sort` (a STORE_COLUMNS sortField).
 *
 * @param {object[]} stores
 * @param {string} query
 * @param {{ field: string | null, direction: 'asc' | 'desc' }} sort
 * @returns {object[]}
 */
export function visibleStores(stores, query, sort) {
  const found = stores.filter((store) => matchesSearch([store.name, store.retailer, store.format], query));
  if (!sort.field) return found;
  const sign = sort.direction === 'asc' ? 1 : -1;
  return [...found].sort((a, b) => {
    const left = a[sort.field];
    const right = b[sort.field];
    return sign * (typeof left === 'number' ? left - right : String(left).localeCompare(String(right)));
  });
}

// ==== Titled card sample =====================================================

// A month-by-month report, as on the Inventory tabs: the Month header is a
// HeaderCheckboxFilter.
export const MONTHLY_ROWS = [
  { month: '2026-07', sku: 'AIRE-TP-M-48', sellOut: 1240, endingStock: 3100, doh: 75 },
  { month: '2026-07', sku: 'AIRE-PT-L-36', sellOut: 860, endingStock: 940, doh: 33 },
  { month: '2026-08', sku: 'AIRE-TP-M-48', sellOut: 1310, endingStock: 2650, doh: 61 },
  { month: '2026-08', sku: 'AIRE-PT-L-36', sellOut: 905, endingStock: 520, doh: 17 },
  { month: '2026-09', sku: 'AIRE-TP-M-48', sellOut: 1180, endingStock: 2900, doh: 74 },
  { month: '2026-09', sku: 'AIRE-PT-L-36', sellOut: 880, endingStock: 1400, doh: 48 },
];
