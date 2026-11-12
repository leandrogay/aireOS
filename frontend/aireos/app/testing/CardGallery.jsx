'use client';

import { useState } from 'react';
import { Pencil } from 'lucide-react';

import GlassPanel from '@/components/dashboard/GlassPanel';
import { InventoryFilterCard, StatTag, filterLabelClass } from '@/components/inventory/InventoryChrome';
import SellInTrendChart from '@/components/inventory/SellInTrendChart';
import ReviewSection from '@/components/mappings/ReviewSection';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import CardSkeleton, { SkeletonBars } from '@/components/ui/CardSkeleton';
import ChartCard from '@/components/ui/ChartCard';
import FilterBar from '@/components/ui/FilterBar';
import FilterSelect from '@/components/ui/FilterSelect';
import MobileRecordCard from '@/components/ui/MobileRecordCard';
import SelectDropdown from '@/components/ui/SelectDropdown';
import StatusPill from '@/components/ui/StatusPill';
import TableCard from '@/components/ui/TableCard';
import TableCardHeader from '@/components/ui/TableCardHeader';
import { glassSurfaceClass } from '@/components/ui/surfaceStyles';

import { NotMigrated, Section, Variant, WhichToUse } from './GalleryParts';

// A living reference for every card shell in the app; see app/testing/page.js.
// The blocks are `bare` so the glass cards sit on the wallpaper, as on a page.
// Charts and tables are drawn in full in their own kits; here each card shows
// just enough to tell it apart. Nothing is fetched.

// ==== Sample data and reference tables ====

const GUIDE = [
  ['A card that none of the others fit', 'Card (ui/card) + glassSurfaceClass', 'CardHeader, CardTitle, CardDescription, CardAction, CardContent, CardFooter; size'],
  ['A chart on a page', 'ChartCard (Charts kit)', 'title, detail, actions, label'],
  ['A table on a page', 'TableCard + TableCardHeader (Tables kit)', 'variant="glass", header, label'],
  ['Filters above a list table', 'FilterBar', 'label, hasFilters, onReset; FilterSelect children'],
  ['Filters above a chart (Inventory)', 'inventory/InventoryFilterCard', 'canClear, onClear, stats, note'],
  ['A table row on a phone', 'MobileRecordCard in a RecordCardList', 'title, subtitle, badge, actions, fields'],
  ['A numbered step on a long review page', 'mappings/ReviewSection', 'id, step, title, info, done, action'],
  ['A dashboard tile', 'dashboard/GlassPanel', 'as, className'],
  ['A card while its page loads', 'CardSkeleton + SkeletonBars, in a PageSkeleton', 'title, subtitle, actions, divider'],
];

// Remove a row when its file migrates.
const NOT_MIGRATED = [
  ['Forecast', 'forecast/ForecastFilters', 'Card + glassSurfaceClass, own Filters heading and Clear', 'InventoryFilterCard, once it can take the forecast\'s grid of fields'],
  ['Inventory', 'inventory/InventoryDataManager', 'Card + a hand-copied serif CardTitle', 'TableCardHeader for the title and mode switch'],
];

const LEAVE_AS_IS = [
  ['Login', 'app/login/page.js', 'The sign-in hero card, one of a kind'],
  ['Upload', 'app/upload/page.js', 'Page sections around the dropzone, glassSurfaceClass directly'],
  ['Nomenclatures', 'mappings/ReviewHeader, ReviewChecklist, ApprovedSummary', 'One-off sections of the review page'],
  ['Inventory', 'inventory/SellInComparison', 'A strip of figures, not a titled card'],
  ['Scenario', 'scenario/ScenarioPanel', 'A collapsible side panel with tabs'],
];

const SAMPLE_TREND = [
  ['2026-04', 1360], ['2026-05', 1180], ['2026-06', 1450],
  ['2026-07', 1600], ['2026-08', 1320], ['2026-09', 1480],
].map(([month, sellIn]) => ({ month, sell_in: sellIn }));

const CUSTOMERS = [
  { value: 'fairprice', label: 'FairPrice' },
  { value: 'sheng_shiong', label: 'Sheng Siong' },
];

const PROMO_TYPES = [
  { value: 'catalogue', label: 'Catalogue' },
  { value: 'display', label: 'Display' },
];

// ==== Gallery ====

export default function CardGallery() {
  const [customer, setCustomer] = useState('');
  const [promoType, setPromoType] = useState('');
  const [inventoryCustomer, setInventoryCustomer] = useState('fairprice');
  const hasFilters = Boolean(customer || promoType);

  return (
    <div>
      <WhichToUse
        rows={GUIDE}
        note="Every outer card is frosted glass over the wallpaper (glassSurfaceClass). Reach for the most specific shell first; Card with glassSurfaceClass is the fallback."
      />

      <Section bare title="Base card — Card" note="The shadcn Card every other shell builds on or copies. Compose only the pieces a card needs; give the outer Card glassSurfaceClass.">
        <div className="sm:col-span-2 lg:col-span-2">
          <Variant name="All the pieces" props="CardHeader, CardTitle, CardDescription, CardAction, CardContent, CardFooter" value={null}>
            <Card className={glassSurfaceClass}>
              <CardHeader>
                <CardTitle className="font-serif font-normal text-deep-violet-blue">Card title</CardTitle>
                <CardDescription>A line of supporting text.</CardDescription>
                <CardAction>
                  <Button variant="outline" size="sm">Action</Button>
                </CardAction>
              </CardHeader>
              <CardContent className="text-deep-violet-blue">The card&apos;s body.</CardContent>
              <CardFooter className="text-xs text-deep-violet-blue/70">Footer</CardFooter>
            </Card>
          </Variant>
        </div>
        <div className="sm:col-span-2 lg:col-span-2">
          <Variant name="Small" props='size="sm"' value={null}>
            <Card size="sm" className={glassSurfaceClass}>
              <CardHeader>
                <CardTitle className="font-serif font-normal text-deep-violet-blue">Small card</CardTitle>
                <CardDescription>Tighter spacing (12px).</CardDescription>
              </CardHeader>
              <CardContent className="text-deep-violet-blue">The card&apos;s body.</CardContent>
            </Card>
          </Variant>
        </div>
      </Section>

      <Section bare title="Content cards — ChartCard, TableCard" note="The two titled cards a page's data sits in; both share TableCardHeader's title style. Their full states are in the Charts and Tables kits.">
        <div className="sm:col-span-2 lg:col-span-2">
          <Variant name="ChartCard" props="title, detail, actions" value={null}>
            <ChartCard title="Sell-in trend" detail="Monthly, FairPrice">
              <SellInTrendChart trend={SAMPLE_TREND} />
            </ChartCard>
          </Variant>
        </div>
        <div className="sm:col-span-2 lg:col-span-2">
          <Variant name="TableCard, glass and default" props='variant="glass" | "default", header' value={null}>
            <div className="space-y-3">
              <TableCard variant="glass" label="Glass table card" header={<TableCardHeader title="Glass" detail="variant=&quot;glass&quot;: list pages" />}>
                <p className="px-4 pb-4 text-sm text-deep-violet-blue/70">The table goes here.</p>
              </TableCard>
              <TableCard label="Default table card" header={<TableCardHeader title="Default" detail="Solid white header" />}>
                <p className="px-4 pb-4 text-sm text-deep-violet-blue/70">The table goes here.</p>
              </TableCard>
            </div>
          </Variant>
        </div>
      </Section>

      <Section bare title="Filter cards — FilterBar, InventoryFilterCard" note="FilterBar sits above a list table (Promotions, SKUs, Nomenclatures) and resets; InventoryFilterCard sits above the Inventory charts with summary pills and Clear.">
        <div className="sm:col-span-2 lg:col-span-2">
          <Variant name="FilterBar" props="label, hasFilters, onReset" value={{ customer, promoType }}>
            <FilterBar label="Promotion filters" hasFilters={hasFilters} onReset={() => { setCustomer(''); setPromoType(''); }}>
              <FilterSelect label="Customer" value={customer} allLabel="All customers" options={CUSTOMERS} onChange={setCustomer} />
              <FilterSelect label="Type" value={promoType} allLabel="All types" options={PROMO_TYPES} onChange={setPromoType} />
            </FilterBar>
          </Variant>
        </div>
        <div className="sm:col-span-2 lg:col-span-2">
          <Variant name="InventoryFilterCard" props="canClear, onClear, stats, note" value={inventoryCustomer}>
            <InventoryFilterCard
              canClear={inventoryCustomer !== 'fairprice'}
              onClear={() => setInventoryCustomer('fairprice')}
              stats={<StatTag label="SKUs" value="12" />}
              note="A note under the fields."
            >
              <div>
                <span className={filterLabelClass}>Customer</span>
                <SelectDropdown value={inventoryCustomer} onChange={setInventoryCustomer} options={CUSTOMERS} ariaLabel="Customer" look="compact" />
              </div>
            </InventoryFilterCard>
          </Variant>
        </div>
      </Section>

      <Section bare title="Record, step and tile cards" note="MobileRecordCard is a table row on a phone (list them in a RecordCardList); ReviewSection is one numbered step of the mapping review; GlassPanel is a dashboard tile.">
        <Variant name="MobileRecordCard" props="title, subtitle, badge, actions, fields" value={null}>
          <MobileRecordCard
            title="FairPrice Xtra"
            subtitle="Store 0412"
            badge={<StatusPill tone="success">Active</StatusPill>}
            actions={(
              <Button variant="ghost" size="icon-sm" aria-label="Edit">
                <Pencil className="size-4" />
              </Button>
            )}
            fields={[
              { label: 'Units sold', value: '1,480' },
              { label: 'Month', value: 'Sep 2026' },
            ]}
          />
        </Variant>
        <div className="sm:col-span-2 lg:col-span-2">
          <Variant name="ReviewSection" props="id, step, title, info, done, action" value={null}>
            <div className="space-y-3">
              <ReviewSection id="gallery-step-done" step={1} title="Customer" info="Which customer the file belongs to." done>
                <p className="text-sm text-deep-violet-blue/70">A finished step.</p>
              </ReviewSection>
              <ReviewSection id="gallery-step-todo" step={2} title="Product codes" done={false}>
                <p className="text-sm text-deep-violet-blue/70">A step that still needs the reviewer.</p>
              </ReviewSection>
            </div>
          </Variant>
        </div>
        <Variant name="GlassPanel" props="as, className" value={null}>
          <GlassPanel>
            <p className="text-xs text-deep-violet-blue/70">Revenue</p>
            <p className="font-serif text-2xl">$48,210</p>
          </GlassPanel>
        </Variant>
      </Section>

      <Section bare title="Loading — CardSkeleton" note="A card's placeholder while its page loads; fill the body with SkeletonBars or a chart skeleton, and put the cards in a PageSkeleton.">
        <Variant name="Title only" props="title" value={null}>
          <CardSkeleton>
            <SkeletonBars widths={['w-full', 'w-4/5', 'w-2/3']} />
          </CardSkeleton>
        </Variant>
        <Variant name="Title, subtitle, actions" props="subtitle, actions={2}" value={null}>
          <CardSkeleton subtitle actions={2}>
            <SkeletonBars widths={['w-full', 'w-3/4']} />
          </CardSkeleton>
        </Variant>
        <Variant name="Divider under the header" props="divider" value={null}>
          <CardSkeleton divider>
            <SkeletonBars inline count={3} widths={['w-16', 'w-20', 'w-14']} className="h-6 rounded-full" />
          </CardSkeleton>
        </Variant>
        <Variant name="No header" props="title={false}" value={null}>
          <CardSkeleton title={false}>
            <SkeletonBars widths={['w-full', 'w-5/6', 'w-1/2']} />
          </CardSkeleton>
        </Variant>
      </Section>

      <NotMigrated bare rows={NOT_MIGRATED} leaveAsIs={LEAVE_AS_IS} />
    </div>
  );
}
