'use client';

import { CopyPlus, Replace, SkipForward } from 'lucide-react';
import { useState } from 'react';

import SegmentedControl from '@/components/ui/SegmentedControl';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ToggleButton from '@/components/ui/ToggleButton';
import ToggleField from '@/components/ui/ToggleField';
import { filterLabelClass } from '@/components/inventory/InventoryChrome';

import { Section, Variant } from './GalleryParts';

// A living reference for the toggle kit; see app/testing/page.js.

// Which component to reach for; keep in step with the components themselves.
const GUIDE = [
  ['Pick one of a few, side by side', 'SegmentedControl', 'value, onChange, options, look, size, fullWidth'],
  ['Turn one thing on or off', 'ToggleButton', 'pressed, onChange, look'],
  ['A setting with a switch and an explanation', 'ToggleField', 'label or ariaLabel, checked, onChange, showState, onHint, offHint'],
];

// Controls that should move to the kit, page by page. Remove a row when its
// page migrates.
const NOT_MIGRATED = [
  ['Dashboard', 'dashboard/RevenueTrendCard.jsx', 'ui/tabs: Offline / Online, Volume / Revenue, By week / By month (jumps)', 'SegmentedControl'],
  ['Forecast', 'forecast/ForecastChart.jsx', 'ui/tabs: Volume / Revenue (jumps)', 'SegmentedControl'],
  ['Forecast', 'forecast/ForecastLineToggle.jsx, ForecastPromoToggle.jsx', 'Hand-rolled chips with per-series colours', 'ToggleButton look="chip" (needs a colour option first)'],
  ['Promotions', 'promotions/PromotionDetails.jsx (FormatTab)', 'Hand-rolled chips with a count', 'ToggleButton look="chip"'],
  ['Upload', 'upload/DuplicateChoice.jsx', 'Radio inputs styled as a track, with icons', 'SegmentedControl with option icons'],
  ['Nomenclatures', 'mappings/ChannelValueList.jsx', 'Hand-rolled Online / Offline buttons', 'SegmentedControl'],
];

// Pressed-looking controls that are not toggles, so they stay as they are.
const LEAVE_AS_IS = [
  ['Dashboard', 'dashboard/DateRangeControl.jsx', 'Period presets: a menu list that closes on pick'],
  ['Dashboard', 'dashboard/SkuRanking.jsx (SortHeader)', 'Sort pills: choose a sort column and direction'],
  ['Shared', 'ui/MonthGrid.jsx', 'Month calendar cells'],
  ['Nomenclatures', 'mappings/ChannelSplit.jsx', 'Radio cards with a description under each option'],
];

const METRICS = [
  { value: 'units', label: 'Volume' },
  { value: 'revenue', label: 'Revenue' },
];

const GRANULARITIES = [
  { value: 'week', label: 'By week', disabled: true, title: 'No weekly data in this range' },
  { value: 'month', label: 'By month' },
];

const MODES = [
  { value: 'upload', label: 'Upload' },
  { value: 'create', label: 'Create' },
  { value: 'edit', label: 'Edit' },
  { value: 'shipped', label: 'Temporary sell-in' },
];

const VIEWS = [
  { value: 'overview', label: 'Overview' },
  { value: 'customer', label: 'By customer' },
  { value: 'risk', label: 'At risk' },
  { value: 'plan', label: 'Sell-in plan' },
];

const DUPLICATE_CHOICES = [
  { value: 'replace', label: 'Replace earlier', icon: Replace },
  { value: 'keep', label: 'Keep both', icon: CopyPlus },
  { value: 'skip', label: 'Skip', icon: SkipForward },
];

const FORMATS = ['Hypermarket', 'Supermarket', 'Convenience'];

// The dashboard's trigger classes, copied for the legacy demo.
const LEGACY_TAB_TRIGGER_CLASS =
  'text-deep-violet-blue/70 hover:text-deep-violet-blue data-active:bg-deep-violet-blue data-active:text-white data-active:hover:text-white';

/**
 * @param {{ head: string[], rows: string[][] }} props
 */
function ReferenceTable({ head, rows }) {
  return (
    <div className="overflow-x-auto rounded-md border border-lavander">
      <table className="w-full text-left text-xs text-deep-violet-blue">
        <thead className="bg-cream">
          <tr className="border-b border-lavander">
            {head.map((label) => (
              <th key={label} className="px-2.5 py-2 font-semibold">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.join('|')} className="border-b border-lavander/80 last:border-b-0">
              {row.map((cell, index) => (
                <td key={index} className={index === 1 ? 'px-2.5 py-2 font-mono' : 'px-2.5 py-2'}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ToggleGallery() {
  const [segments, setSegments] = useState({
    metric: 'revenue',
    granularity: 'month',
    mode: 'upload',
    view: 'overview',
    duplicate: 'replace',
  });
  const [pressed, setPressed] = useState({ atRisk: false, formats: ['Hypermarket'] });
  // One value per ToggleField example, so each switch moves on its own.
  const [settings, setSettings] = useState({
    bare: true,
    bareState: false,
    label: true,
    labelState: false,
    labelHints: true,
    full: false,
  });
  const [legacy, setLegacy] = useState('week');

  const setSetting = (key) => (value) => setSettings((prev) => ({ ...prev, [key]: value }));
  const setSegment = (key) => (value) => setSegments((prev) => ({ ...prev, [key]: value }));

  function toggleFormat(format) {
    setPressed((prev) => ({
      ...prev,
      formats: prev.formats.includes(format)
        ? prev.formats.filter((item) => item !== format)
        : [...prev.formats, format],
    }));
  }

  return (
    <div className="mt-8">
      <h2 className="mb-3 font-serif text-2xl text-deep-violet-blue">Toggles</h2>

      <section className="mb-4 rounded-lg border border-lavander bg-white p-4 shadow-sm">
        <h2 className="font-serif text-lg text-deep-violet-blue">How to use this kit</h2>
        <p className="mb-3 text-xs text-deep-violet-blue/60">
          Every control below is the real shared component. Build new switches and on/off buttons on these rather than
          on ui/tabs, a raw Switch or a hand-rolled button with aria-pressed. The Inventory page is the reference for SegmentedControl and ToggleButton; the DOH alerts and the nomenclature file settings use ToggleField.
        </p>
        <ReferenceTable head={['I need to…', 'Use', 'Main props']} rows={GUIDE} />
        <p className="mt-3 text-xs text-deep-violet-blue/70">
          SegmentedControl&apos;s <span className="font-medium">look</span>: <span className="font-mono">tint</span>{' '}
          (lavender track) inside cards, <span className="font-mono">outline</span> (white, bordered) for a
          page&apos;s top-level tabs. Its highlight slides on the Sidebar&apos;s spring and is instant for users who
          ask for reduced motion.
        </p>
      </section>

      <Section
        title="SegmentedControl — pick one of a few"
        note="The highlight slides between options. Arrow keys move between them. Used by Inventory's tabs and the Enter / edit data modes."
      >
        <Variant name="Tint, sm (chart metric)" props={'look="tint" size="sm"'} value={segments.metric}>
          <SegmentedControl value={segments.metric} onChange={setSegment('metric')} options={METRICS} />
        </Variant>
        <Variant name="Tint, sm, form modes (inventory)" props={'look="tint" size="sm"'} value={segments.mode}>
          <SegmentedControl value={segments.mode} onChange={setSegment('mode')} options={MODES} />
        </Variant>
        <Variant name="Disabled option, with title" props="options[].disabled, options[].title" value={segments.granularity}>
          <SegmentedControl value={segments.granularity} onChange={setSegment('granularity')} options={GRANULARITIES} />
        </Variant>
        <Variant name="With icons" props="options[].icon" value={segments.duplicate}>
          <SegmentedControl value={segments.duplicate} onChange={setSegment('duplicate')} options={DUPLICATE_CHOICES} />
        </Variant>
        <div className="sm:col-span-2 lg:col-span-4">
          <Variant name="Outline, md, full width (inventory page tabs)" props={'look="outline" size="md" fullWidth'} value={segments.view}>
            <SegmentedControl
              value={segments.view}
              onChange={setSegment('view')}
              options={VIEWS}
              look="outline"
              size="md"
              fullWidth
            />
          </Variant>
        </div>
      </Section>

      <Section title="ToggleButton — one thing on or off" note="Stays pressed while on. Used by Inventory's “At risk only” filter.">
        <Variant name="Compact (inventory filters)" props={'look="compact"'} value={pressed.atRisk}>
          <span className={filterLabelClass}>At risk</span>
          <ToggleButton pressed={pressed.atRisk} onChange={(value) => setPressed((prev) => ({ ...prev, atRisk: value }))}>
            At risk only
          </ToggleButton>
        </Variant>
        <Variant name="Chips, a row of filters" props={'look="chip"'} value={pressed.formats}>
          <div className="flex flex-wrap gap-1.5">
            {FORMATS.map((format) => (
              <ToggleButton
                key={format}
                look="chip"
                pressed={pressed.formats.includes(format)}
                onChange={() => toggleFormat(format)}
              >
                {format}
              </ToggleButton>
            ))}
          </div>
        </Variant>
        <Variant name="Disabled" props="disabled" value={false}>
          <div className="space-y-2">
            <ToggleButton pressed={false} onChange={() => {}} disabled>
              At risk only
            </ToggleButton>
            <ToggleButton pressed onChange={() => {}} look="chip" disabled>
              Chip
            </ToggleButton>
          </div>
        </Variant>
      </Section>

      <Section
        title="ToggleField — a setting with a switch"
        note="Just the switch unless you give it a label; add showState for the On / Off pill. With no label, pass ariaLabel so screen readers can name it. Used by the nomenclature file settings and the DOH alerts."
      >
        <Variant name="Switch only (DOH table)" props="ariaLabel" value={settings.bare}>
          <ToggleField ariaLabel="DOH alerts for Fairprice" checked={settings.bare} onChange={setSetting('bare')} />
        </Variant>
        <Variant name="Switch + state" props="ariaLabel showState" value={settings.bareState}>
          <ToggleField
            ariaLabel="DOH alerts for Fairprice"
            showState
            checked={settings.bareState}
            onChange={setSetting('bareState')}
          />
        </Variant>
        <Variant name="Label" props="label" value={settings.label}>
          <ToggleField label="Send DOH alerts" checked={settings.label} onChange={setSetting('label')} />
        </Variant>
        <Variant name="Label + state" props="label showState" value={settings.labelState}>
          <ToggleField
            label="Send DOH alerts"
            showState
            checked={settings.labelState}
            onChange={setSetting('labelState')}
          />
        </Variant>
        <Variant name="Label + hints" props="label onHint offHint" value={settings.labelHints}>
          <ToggleField
            label="Send DOH alerts"
            checked={settings.labelHints}
            onChange={setSetting('labelHints')}
            onHint="An alert is sent when a SKU falls below its min DOH."
            offHint="No alerts for this customer."
          />
        </Variant>
        <Variant name="Label + state + hints (file settings)" props="label showState onHint offHint" value={settings.full}>
          <ToggleField
            label="Add up rows into monthly totals"
            showState
            checked={settings.full}
            onChange={setSetting('full')}
            onHint="Rows for the same store and product are added together, so each month loads as one row."
            offHint="Every row loads as the file has it, for example one per week."
          />
        </Variant>
        <Variant name="Disabled (a save in flight)" props="disabled" value={true}>
          <div className="space-y-2">
            <ToggleField ariaLabel="DOH alerts for Fairprice" checked disabled onChange={() => {}} />
            <ToggleField label="Send DOH alerts" showState checked disabled onChange={() => {}} />
          </div>
        </Variant>
      </Section>

      <section className="mb-4 rounded-lg border border-lavander bg-white p-4 shadow-sm">
        <h2 className="font-serif text-lg text-deep-violet-blue">Not migrated yet</h2>
        <p className="mb-3 text-xs text-deep-violet-blue/60">
          These pages still use their own switches and on/off buttons. Move them to the kit when you&apos;re next
          working in that file, not as a standalone change.
        </p>
        <ReferenceTable head={['Page', 'File (components/)', 'Uses now', 'Migrate to']} rows={NOT_MIGRATED} />

        <div className="mt-4 grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
          <Variant name="Legacy: ui/tabs (Dashboard)" props="jumps, doesn't slide" value={legacy}>
            <Tabs value={legacy} onValueChange={setLegacy}>
              <TabsList className="h-7 bg-lavander">
                <TabsTrigger value="week" className={`text-xs ${LEGACY_TAB_TRIGGER_CLASS}`}>
                  By week
                </TabsTrigger>
                <TabsTrigger value="month" className={`text-xs ${LEGACY_TAB_TRIGGER_CLASS}`}>
                  By month
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </Variant>
          <Variant name="New: SegmentedControl" props="slides" value={legacy}>
            <SegmentedControl
              value={legacy}
              onChange={setLegacy}
              options={[
                { value: 'week', label: 'By week' },
                { value: 'month', label: 'By month' },
              ]}
            />
          </Variant>
        </div>

        <h3 className="mt-5 mb-2 text-sm font-medium text-deep-violet-blue">Leave as is</h3>
        <p className="mb-3 text-xs text-deep-violet-blue/60">Look pressed, but aren&apos;t toggles; don&apos;t migrate these.</p>
        <ReferenceTable head={['Page', 'File (components/)', 'Why it stays']} rows={LEAVE_AS_IS} />
      </section>
    </div>
  );
}
