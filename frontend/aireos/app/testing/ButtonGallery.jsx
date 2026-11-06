'use client';

import { Download, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';

import { Section, Variant } from './GalleryParts';

// A living reference for components/ui/button.jsx; see app/testing/page.js.

const VARIANTS = [
  ['default', 'The one main action of a form, card or dialog (Save, Upload, Confirm)'],
  ['outline', 'The alternative beside it (Cancel, Back), and standalone secondary actions'],
  ['secondary', 'A soft filled action that should not compete with the primary'],
  ['ghost', 'Toolbar and table actions that need no outline'],
  ['destructive', 'The confirming click of a delete or discard, not the button that opens it'],
  ['destructive-outline', 'The button that opens a delete or discard (Discard proposal)'],
  ['link', 'An action that reads as text, inside a table row or a sentence'],
  ['scenario', "The Scenario builder's main actions, to match its chips and switches"],
];

const SIZES = [
  ['sm', 'Tables, filters, toolbars'],
  ['default', 'Forms and dialogs'],
  ['lg', "A page's main action"],
  ['xs', 'Dense inline controls (assistant, inventory clear)'],
];

const ICON_SIZES = ['icon-xs', 'icon-sm', 'icon', 'icon-lg'];

// Which component to reach for; keep in step with the components themselves.
const GUIDE = [
  ['A click that does something', 'Button', 'variant, size, disabled, onClick'],
  ['Pick one of a few, side by side', 'SegmentedControl', 'see Toggles above'],
  ['Turn one thing on or off', 'ToggleButton / ToggleField', 'see Toggles above'],
  ['A row in a menu or a calendar cell', 'Dropdown, MonthGrid', 'interactive surfaces, not buttons'],
];

// Buttons that should move to <Button>, folder by folder. They still carry
// their own classes or the old primaryButtonClass / secondaryButtonClass
// constants in ui/formStyles.js. Remove a row when its folder migrates.
const NOT_MIGRATED = [
  ['Forms and dialogs', 'primaryButtonClass (21 files), secondaryButtonClass (16 files)', 'default / outline'],
  ['Nomenclatures', 'mappings/StepSettings, ChannelSplit, StepsEditor, FieldTable, ReviewHeader', 'raw <button>: filled, link and danger looks'],
  ['Scenario', 'scenario/PromotionsSection, UpliftField, ScenarioPanel, PromotionEditor', 'raw <button>: link and ghost looks'],
  ['Upload', 'upload/UploadFileRow, UploadGroup, UploadBatch, LoadFileRow', 'raw <button>: link and ghost looks'],
  ['Dashboard', 'dashboard/SkuRanking, CompareControl', 'raw <button>: ghost looks'],
  ['Danger', 'ui/ConfirmDialog, mappings/ConfirmDiscardDialog, CustomerStep', 'hand-written red-700 → destructive'],
];

// Clickable things that look like buttons but are not, so they stay as they are.
const LEAVE_AS_IS = [
  ['Shared', 'ui/MonthGrid.jsx, SelectDropdown.jsx, SortHeader.jsx', 'Calendar cells, menu rows and sort headers'],
  ['Layout', 'layout/Sidebar.jsx', 'Navigation items'],
  ['Forecast, Dashboard', 'ForecastLineToggle, FilterBadge', 'Chips and filter badges: ToggleButton look="chip"'],
];

export default function ButtonGallery() {
  const [clicks, setClicks] = useState({});
  const click = (key) => setClicks((prev) => ({ ...prev, [key]: (prev[key] || 0) + 1 }));

  return (
    <>
      <Section title="Buttons: variants" note="Default size. Click one to see it respond.">
        {VARIANTS.map(([variant, use]) => (
          <Variant key={variant} name={use} props={`variant="${variant}"`} value={{ clicks: clicks[variant] || 0 }}>
            <Button variant={variant} onClick={() => click(variant)}>
              {variant === 'link' ? 'View details' : 'Save changes'}
            </Button>
          </Variant>
        ))}
      </Section>

      <Section title="Buttons: sizes" note="Three heights for text buttons: sm, default, lg. xs is for dense inline controls.">
        {SIZES.map(([size, use]) => (
          <Variant key={size} name={use} props={`size="${size}"`} value={{ clicks: clicks[size] || 0 }}>
            <div className="flex flex-wrap items-center gap-2">
              <Button size={size} onClick={() => click(size)}>
                Save
              </Button>
              <Button size={size} variant="outline" onClick={() => click(size)}>
                Cancel
              </Button>
            </div>
          </Variant>
        ))}
      </Section>

      <Section title="Buttons: icons and states">
        <Variant name="Icon before the label" props="<Plus data-icon='inline-start' />" value={null}>
          <Button>
            <Plus data-icon="inline-start" /> Add SKU
          </Button>
        </Variant>
        <Variant name="Icon after the label" props="<Download data-icon='inline-end' />" value={null}>
          <Button variant="outline">
            Export <Download data-icon="inline-end" />
          </Button>
        </Variant>
        <Variant name="Icon only (needs an aria-label)" props={`size="${ICON_SIZES.join(' | ')}"`} value={null}>
          <div className="flex items-center gap-2">
            {ICON_SIZES.map((size) => (
              <Button key={size} variant="outline" size={size} aria-label={`Refresh (${size})`}>
                <RefreshCw />
              </Button>
            ))}
          </div>
        </Variant>
        <Variant name="Dismiss" props='variant="ghost" size="icon-sm"' value={null}>
          <Button variant="ghost" size="icon-sm" aria-label="Close">
            <X />
          </Button>
        </Variant>
        <Variant name="Destructive with an icon" props='variant="destructive"' value={null}>
          <Button variant="destructive">
            <Trash2 data-icon="inline-start" /> Delete
          </Button>
        </Variant>
        <Variant name="Disabled, every variant" props="disabled" value={null}>
          <div className="flex flex-wrap items-center gap-2">
            {VARIANTS.map(([variant]) => (
              <Button key={variant} variant={variant} size="sm" disabled>
                {variant}
              </Button>
            ))}
          </div>
        </Variant>
        <Variant name="Invalid field action" props="aria-invalid" value={null}>
          <Button variant="outline" aria-invalid="true">
            Choose a customer
          </Button>
        </Variant>
        <Variant name="Full width" props='className="w-full"' value={null}>
          <Button className="w-full">Upload 3 files</Button>
        </Variant>
      </Section>

      <section className="mb-4 rounded-lg border border-lavander bg-white p-4 shadow-sm">
        <h2 className="font-serif text-lg text-deep-violet-blue">Buttons: which to use</h2>
        <GalleryTable head={['When', 'Use', 'Props']} rows={GUIDE} />
        <h3 className="mt-5 text-sm font-medium text-deep-violet-blue">Not migrated yet</h3>
        <GalleryTable head={['Where', 'Files', 'Becomes']} rows={NOT_MIGRATED} />
        <h3 className="mt-5 text-sm font-medium text-deep-violet-blue">Left as they are</h3>
        <GalleryTable head={['Where', 'Files', 'Why']} rows={LEAVE_AS_IS} />
      </section>
    </>
  );
}

function GalleryTable({ head, rows }) {
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full text-left text-xs text-deep-violet-blue">
        <thead>
          <tr className="border-b border-lavander text-deep-violet-blue/60">
            {head.map((label) => (
              <th key={label} className="py-1.5 pr-4 font-medium">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row[0] + row[1]} className="border-b border-lavander/60 align-top">
              {row.map((cell, index) => (
                <td key={cell} className={index === 1 ? 'py-1.5 pr-4 font-mono text-[11px]' : 'py-1.5 pr-4'}>
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
