'use client';

import { useState } from 'react';

import Dropdown from '@/components/ui/Dropdown';
import FilterSelect from '@/components/ui/FilterSelect';
import MonthDropdown from '@/components/ui/MonthDropdown';
import MultiSelectDropdown from '@/components/ui/MultiSelectDropdown';
import SelectDropdown from '@/components/ui/SelectDropdown';
import { filterLabelClass } from '@/components/inventory/InventoryChrome';

import { NotMigrated, Section, Variant, WhichToUse } from './GalleryParts';

// A living reference for the dropdown kit; see app/testing/page.js.

// How the Dashboard's filter card styles its native selects, shown for
// comparison with the kit's dropdowns.
const NATIVE_SELECT_CLASS =
  'w-full px-2 py-1 text-xs rounded-md border bg-white text-deep-violet-blue border-violet disabled:opacity-50';

// Which component to reach for; keep in step with ui/Dropdown and its children.
const GUIDE = [
  ['Pick one value from a list', 'SelectDropdown', 'value, onChange, options (or groups)'],
  ['Pick any number from a list', 'MultiSelectDropdown', 'values, onChange, options, noneMeansAll'],
  ['Pick one month', 'MonthDropdown', 'value (YYYY-MM), onChange, min / max'],
  ['Something else in the panel', 'Dropdown', 'summary, children (query, close) => nodes'],
];

// Selects that should move to the kit, page by page. Remove a row when its
// page migrates.
const NOT_MIGRATED = [
  ['Promotions', 'promotions/PromotionFilters.jsx', 'ui/FilterSelect (native select)', 'SelectDropdown look="filter"'],
  ['SKUs', 'skus/SkuFilters.jsx', 'ui/FilterSelect (native select)', 'SelectDropdown look="filter"'],
  ['Settings', 'settings/PromoUpliftFilters.jsx', 'ui/FilterSelect (native select)', 'SelectDropdown look="filter"'],
  ['Dashboard', 'dashboard/DashboardFilters.jsx', 'Raw <select> (2)', 'SelectDropdown look="compact"'],
  ['Forecast', 'forecast/ForecastFilters.jsx', 'Raw <select> (2)', 'SelectDropdown look="compact"'],
  ['Inventory', 'inventory/CustomerDropdown.jsx', 'Raw <select>', 'SelectDropdown look="compact"'],
  ['Promotions', 'promotions/PromotionForm.jsx', 'Raw <select>', 'SelectDropdown look="field"'],
  ['Scenario', 'scenario/BlockEditor.jsx (4), PromotionEditor.jsx (6)', 'Raw <select>', 'SelectDropdown look="field"'],
  ['Settings', 'settings/PromoOverrideForm.jsx', 'Raw <select> (4)', 'SelectDropdown look="field"'],
  ['Customers', 'customers/LinkRetailerDialog.jsx', 'Raw <select>', 'SelectDropdown look="field"'],
  ['Tables', 'ui/TablePagination.jsx', 'Raw <select> (page size)', 'SelectDropdown look="field" size="sm"'],
];

const CUSTOMERS = [
  { value: '1', label: 'Fairprice' },
  { value: '2', label: 'Sheng Siong' },
  { value: '3', label: 'Singhealth' },
  { value: '4', label: 'NHG' },
  { value: '5', label: 'Prime Supermarket' },
];

const STATUSES = [
  { value: '', label: 'All' },
  { value: 'below_min', label: 'Below min' },
  { value: 'in_band', label: 'In band' },
  { value: 'above_max', label: 'Above max' },
];

const SKUS = [
  { value: 'AIR-NB-S', label: 'Aire Newborn Diapers S (44s)', hint: 'AIR-NB-S' },
  { value: 'AIR-NB-M', label: 'Aire Newborn Diapers M (38s)', hint: 'AIR-NB-M' },
  { value: 'AIR-PT-L', label: 'Aire Pants L (34s)', hint: 'AIR-PT-L' },
  { value: 'AIR-PT-XL', label: 'Aire Pants XL (30s)', hint: 'AIR-PT-XL' },
  { value: 'AIR-PT-XXL', label: 'Aire Pants XXL (26s)', hint: 'AIR-PT-XXL' },
  { value: 'AIR-WW-80', label: 'Aire Baby Wipes Fragrance-Free (80s)', hint: 'AIR-WW-80' },
  { value: 'AIR-WW-3X80', label: 'Aire Baby Wipes Fragrance-Free Value Pack (3 x 80s)', hint: 'AIR-WW-3X80' },
  { value: 'AIR-CR-50', label: 'Aire Nappy Cream (50ml)', hint: 'AIR-CR-50' },
  { value: 'AIR-SH-200', label: 'Aire Baby Shampoo (200ml)', hint: 'AIR-SH-200' },
  { value: 'AIR-LO-200', label: 'Aire Baby Lotion (200ml)', hint: 'AIR-LO-200' },
];

const STORES = [
  { value: '101', label: 'FairPrice Xtra Ang Mo Kio', hint: '101' },
  { value: '102', label: 'FairPrice Finest Bukit Timah', hint: '102' },
  { value: '103', label: 'FairPrice Hougang Mall', hint: '103' },
  { value: '104', label: 'FairPrice Jurong Point', hint: '104' },
  { value: '105', label: 'FairPrice Tampines Hub', hint: '105' },
];

const COLUMN_GROUPS = [
  {
    label: 'Columns not used yet',
    options: [
      { value: 'Article', label: 'Article', hint: 'AIR-NB-S, AIR-PT-L', description: 'Looks like product codes.' },
      { value: 'Description', label: 'Description', hint: 'Aire Newborn…', description: 'Product names as the retailer writes them.' },
    ],
  },
  {
    label: 'Already used',
    options: [
      { value: 'Qty', label: 'Qty', hint: '→ units' },
      { value: 'Sales $', label: 'Sales $', hint: '→ revenue', disabled: true },
    ],
  },
];

export default function DropdownGallery() {
  const [single, setSingle] = useState({
    fieldMd: '2',
    fieldSm: '',
    filter: '',
    compact: '1',
    searchable: '',
    groups: '',
    action: '',
    invalid: '',
  });
  const [multi, setMulti] = useState({
    fieldRequired: [],
    fieldSome: ['101', '103'],
    filter: [],
    compactSkus: [],
    compactSome: ['AIR-PT-L'],
  });
  const [months, setMonths] = useState({ field: '2026-07', compact: '', bounded: '2026-03' });
  const [native, setNative] = useState({ filterSelect: '', inventory: '1', form: '2' });
  const [lastAction, setLastAction] = useState('');

  const setOne = (key) => (value) => setSingle((prev) => ({ ...prev, [key]: value }));
  const setMany = (key) => (values) => setMulti((prev) => ({ ...prev, [key]: values }));
  const setMonth = (key) => (value) => setMonths((prev) => ({ ...prev, [key]: value }));

  return (
    <div>
      <WhichToUse
        rows={GUIDE}
        note="Every control below is the real shared component with sample data, so click around: open them, search, tick, pick. The line under each shows the value it currently holds and the props it was built with. Build new dropdowns on these rather than on a raw Popover or a native select."
      >
        <span className="font-medium">look</span> sets where it sits: <span className="font-mono">field</span> in
        forms and tables, <span className="font-mono">filter</span> in a FilterBar,{' '}
        <span className="font-mono">compact</span> in the inventory filter cards. Turn on search with{' '}
        <span className="font-mono">searchable</span> for long lists.
      </WhichToUse>

      <Section
        title="SelectDropdown — pick one"
        note="✓ on the chosen row, closes on pick. Used by the mapping review, promo type, inventory Customer / DOH status."
      >
        <Variant name="Field, md (forms)" props={'look="field" size="md"'} value={single.fieldMd}>
          <SelectDropdown value={single.fieldMd} onChange={setOne('fieldMd')} options={CUSTOMERS} placeholder="Choose a customer…" />
        </Variant>
        <Variant name="Field, sm (mapping tables)" props={'look="field" size="sm"'} value={single.fieldSm}>
          <SelectDropdown value={single.fieldSm} onChange={setOne('fieldSm')} options={CUSTOMERS} size="sm" placeholder="Choose…" />
        </Variant>
        <Variant name="Filter (FilterBar)" props={'look="filter"'} value={single.filter}>
          <SelectDropdown value={single.filter} onChange={setOne('filter')} options={STATUSES} look="filter" />
        </Variant>
        <Variant name="Compact (inventory filters)" props={'look="compact"'} value={single.compact}>
          <span className={filterLabelClass}>Customer</span>
          <SelectDropdown value={single.compact} onChange={setOne('compact')} options={CUSTOMERS} look="compact" />
        </Variant>
        <Variant name="Searchable, long labels" props="searchable" value={single.searchable}>
          <SelectDropdown
            value={single.searchable}
            onChange={setOne('searchable')}
            options={SKUS}
            searchable
            searchPlaceholder="Search SKUs…"
            placeholder="Choose a SKU…"
          />
        </Variant>
        <Variant name="Groups, hints, descriptions, disabled option" props="groups" value={single.groups}>
          <SelectDropdown
            value={single.groups}
            onChange={setOne('groups')}
            groups={COLUMN_GROUPS}
            size="sm"
            placeholder="Choose a column…"
          />
        </Variant>
        <Variant name="Pinned action row" props="action searchable" value={lastAction || single.action}>
          <SelectDropdown
            value={single.action}
            onChange={setOne('action')}
            options={CUSTOMERS}
            searchable
            placeholder="Choose a customer…"
            action={{
              label: (query) => (query ? `Create "${query}"` : 'Create new customer'),
              onSelect: (query) => setLastAction(`action: ${query || '(empty)'}`),
            }}
          />
        </Variant>
        <Variant name="Invalid / disabled" props="invalid · disabled" value={single.invalid}>
          <div className="space-y-2">
            <SelectDropdown value={single.invalid} onChange={setOne('invalid')} options={CUSTOMERS} invalid placeholder="Required" />
            <SelectDropdown value="" onChange={() => {}} options={CUSTOMERS} disabled placeholder="Disabled" />
          </div>
        </Variant>
      </Section>

      <Section
        title="MultiSelectDropdown — pick many"
        note="Tick boxes + an “All” row, stays open. noneMeansAll: filters treat nothing ticked as all; required form fields don't."
      >
        <Variant name="Field, required (promotion form)" props={'look="field" noneMeansAll={false}'} value={multi.fieldRequired}>
          <MultiSelectDropdown
            options={CUSTOMERS}
            values={multi.fieldRequired}
            onChange={setMany('fieldRequired')}
            allLabel="All retailers"
            noneMeansAll={false}
            placeholder="Select retailers"
          />
        </Variant>
        <Variant name="Field, some picked, with hints" props={'noneMeansAll={false} searchable'} value={multi.fieldSome}>
          <MultiSelectDropdown
            options={STORES}
            values={multi.fieldSome}
            onChange={setMany('fieldSome')}
            allLabel="All stores"
            noneMeansAll={false}
            searchable
            searchPlaceholder="Search stores…"
            placeholder="Select stores"
          />
        </Variant>
        <Variant name="Filter, with label (Nomenclatures)" props={'look="filter" label'} value={multi.filter}>
          <MultiSelectDropdown
            look="filter"
            label="Customer"
            options={CUSTOMERS}
            values={multi.filter}
            onChange={setMany('filter')}
            allLabel="All customers"
          />
        </Variant>
        <Variant name="Compact, all SKUs (inventory)" props={'look="compact" searchable listClassName="max-h-none"'} value={multi.compactSkus}>
          <span className={filterLabelClass}>SKU</span>
          <MultiSelectDropdown
            look="compact"
            options={SKUS}
            values={multi.compactSkus}
            onChange={setMany('compactSkus')}
            allLabel="All SKUs"
            searchable
            searchPlaceholder="Search SKUs…"
            listClassName="max-h-none"
          />
        </Variant>
        <Variant name="Compact, one picked" props={'look="compact"'} value={multi.compactSome}>
          <span className={filterLabelClass}>SKU</span>
          <MultiSelectDropdown
            look="compact"
            options={SKUS}
            values={multi.compactSome}
            onChange={setMany('compactSome')}
            allLabel="All SKUs"
          />
        </Variant>
        <Variant name="No options / disabled" props="options={[]} · disabled" value={[]}>
          <div className="space-y-2">
            <MultiSelectDropdown options={[]} values={[]} onChange={() => {}} placeholder="No customers yet" look="filter" />
            <MultiSelectDropdown options={CUSTOMERS} values={[]} onChange={() => {}} disabled noneMeansAll={false} placeholder="Select retailers first" />
          </div>
        </Variant>
      </Section>

      <Section title="MonthDropdown — pick a month" note="Month grid in a panel the button's width. Used by promotions MonthPicker and inventory From / To.">
        <Variant name="Field (promotion form)" props={'look="field"'} value={months.field}>
          <MonthDropdown value={months.field} onChange={setMonth('field')} />
        </Variant>
        <Variant name="Compact (inventory From / To)" props={'look="compact"'} value={months.compact}>
          <span className={filterLabelClass}>From</span>
          <MonthDropdown value={months.compact} onChange={setMonth('compact')} look="compact" placeholder="Any month" />
        </Variant>
        <Variant name="Bounded + data range" props={'min="2026-01" max="2026-09" dataStart/End'} value={months.bounded}>
          <MonthDropdown
            value={months.bounded}
            onChange={setMonth('bounded')}
            min="2026-01"
            max="2026-09"
            dataStart="2026-02"
            dataEnd="2026-06"
          />
        </Variant>
      </Section>

      <Section title="Dropdown — the shell with custom content" note="What SkuForm's type-to-add fields use directly.">
        <Variant name="Field, custom panel" props="children" value={null}>
          <Dropdown summary="Custom content" placeholder="Open me">
            <p className="px-2 py-1 text-sm">Anything can go in the panel.</p>
          </Dropdown>
        </Variant>
        <Variant name="Each look, empty" props="look field / filter / compact" value={null}>
          <div className="space-y-2">
            <Dropdown summary="" placeholder="field" look="field">{null}</Dropdown>
            <Dropdown summary="" placeholder="filter" look="filter">{null}</Dropdown>
            <Dropdown summary="" placeholder="compact" look="compact">{null}</Dropdown>
          </div>
        </Variant>
      </Section>

      <NotMigrated rows={NOT_MIGRATED}>
        <Variant name="Old: ui/FilterSelect (native)" props="native select" value={native.filterSelect}>
          <FilterSelect
            label="Status"
            value={native.filterSelect}
            allLabel="All statuses"
            options={STATUSES.slice(1)}
            onChange={(value) => setNative((prev) => ({ ...prev, filterSelect: value }))}
          />
        </Variant>
        <Variant name="New: SelectDropdown, filter" props={'look="filter"'} value={native.filterSelect}>
          <span className={filterLabelClass}>Status</span>
          <SelectDropdown
            look="filter"
            value={native.filterSelect}
            options={STATUSES}
            onChange={(value) => setNative((prev) => ({ ...prev, filterSelect: value }))}
          />
        </Variant>
        <Variant name="Old: raw <select> (Dashboard, Forecast)" props="native, plain classes" value={native.inventory}>
          <span className={filterLabelClass}>Customer</span>
          <select
            value={native.inventory}
            onChange={(event) => setNative((prev) => ({ ...prev, inventory: event.target.value }))}
            className={NATIVE_SELECT_CLASS}
          >
            {CUSTOMERS.map((customer) => (
              <option key={customer.value} value={customer.value}>
                {customer.label}
              </option>
            ))}
          </select>
        </Variant>
        <Variant name="New: SelectDropdown, compact" props={'look="compact"'} value={native.inventory}>
          <span className={filterLabelClass}>Customer</span>
          <SelectDropdown
            look="compact"
            value={native.inventory}
            options={CUSTOMERS}
            onChange={(value) => setNative((prev) => ({ ...prev, inventory: value }))}
          />
        </Variant>
        <Variant name="Old: raw <select> in a form" props="native, cream field classes" value={native.form}>
          <select
            value={native.form}
            onChange={(event) => setNative((prev) => ({ ...prev, form: event.target.value }))}
            className="w-full rounded-glass-sm border border-deep-violet-blue/60 bg-white px-2.5 py-1.5 text-sm text-deep-violet-blue transition-[border-color,background-color] duration-hover hover:border-deep-violet-blue/75 focus-ring"
          >
            {CUSTOMERS.map((customer) => (
              <option key={customer.value} value={customer.value}>
                {customer.label}
              </option>
            ))}
          </select>
        </Variant>
        <Variant name="New: SelectDropdown, field" props={'look="field"'} value={native.form}>
          <SelectDropdown
            value={native.form}
            options={CUSTOMERS}
            onChange={(value) => setNative((prev) => ({ ...prev, form: value }))}
          />
        </Variant>
      </NotMigrated>
    </div>
  );
}
