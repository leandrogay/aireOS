'use client';

import { Download, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';

import { NotMigrated, Section, Variant, WhichToUse } from './GalleryParts';

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
  ['Pick one of a few, side by side', 'SegmentedControl', 'see Toggles'],
  ['Turn one thing on or off', 'ToggleButton / ToggleField', 'see Toggles'],
  ['A row in a menu or a calendar cell', 'Dropdown, MonthGrid', 'interactive surfaces, not buttons'],
];

// Buttons that should move to <Button>, folder by folder. They still carry
// their own classes or the old primaryButtonClass / secondaryButtonClass
// constants in ui/formStyles.js. Remove a row when its folder migrates.
const NOT_MIGRATED = [
  ['Forms and dialogs', 'every file importing ui/formStyles.js (21 + 16)', 'primaryButtonClass, secondaryButtonClass', 'Button default / outline'],
  ['Nomenclatures', 'mappings/StepSettings, ChannelSplit, StepsEditor, FieldTable, ReviewHeader', 'Raw <button>: filled, link and danger looks', 'Button'],
  ['Scenario', 'scenario/PromotionsSection, UpliftField, ScenarioPanel, PromotionEditor', 'Raw <button>: link and ghost looks', 'Button link / ghost'],
  ['Upload', 'upload/UploadFileRow, UploadGroup, UploadBatch, LoadFileRow', 'Raw <button>: link and ghost looks', 'Button link / ghost'],
  ['Dashboard', 'dashboard/SkuRanking, CompareControl', 'Raw <button>: ghost looks', 'Button ghost'],
  ['Delete / discard dialogs', 'ui/ConfirmDialog, mappings/ConfirmDiscardDialog, CustomerStep', 'Hand-written red-700 classes', 'Button destructive'],
];

// Clickable things that look like buttons but are not, so they stay as they are.
const LEAVE_AS_IS = [
  ['Shared', 'ui/MonthGrid.jsx, SelectDropdown.jsx, SortHeader.jsx', 'Calendar cells, menu rows and sort headers'],
  ['Layout', 'layout/Sidebar.jsx', 'Navigation items'],
  ['Forecast, Dashboard', 'ForecastLineToggle, FilterBadge', 'Chips and filter badges: ToggleButton look="chip"'],
];

// What the raw buttons above look like, for the side-by-side examples.
const OLD_FILLED_CLASS =
  'rounded-md bg-deep-violet-blue px-4 py-1.5 text-sm text-white hover:bg-deep-violet-blue/90';
const OLD_OUTLINE_CLASS =
  'rounded-md border border-deep-violet-blue/30 bg-white px-4 py-1.5 text-sm text-deep-violet-blue hover:bg-cream';
const OLD_LINK_CLASS = 'text-xs font-medium text-deep-violet-blue underline underline-offset-2';
const OLD_DANGER_CLASS = 'rounded-md bg-red-700 px-4 py-1.5 text-sm text-white hover:bg-red-800';

export default function ButtonGallery() {
  const [clicks, setClicks] = useState({});
  const click = (key) => setClicks((prev) => ({ ...prev, [key]: (prev[key] || 0) + 1 }));

  return (
    <>
      <WhichToUse rows={GUIDE} />

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

      <NotMigrated rows={NOT_MIGRATED} leaveAsIs={LEAVE_AS_IS}>
        <Variant name="Old: filled, hand-rolled" props="<button className={...}>" value={null}>
          <button type="button" className={OLD_FILLED_CLASS}>
            Save changes
          </button>
        </Variant>
        <Variant name="New: default" props='<Button variant="default">' value={null}>
          <Button>Save changes</Button>
        </Variant>
        <Variant name="Old: outline, hand-rolled" props="<button className={...}>" value={null}>
          <button type="button" className={OLD_OUTLINE_CLASS}>
            Cancel
          </button>
        </Variant>
        <Variant name="New: outline" props='<Button variant="outline">' value={null}>
          <Button variant="outline">Cancel</Button>
        </Variant>
        <Variant name="Old: link, hand-rolled" props="<button className={...}>" value={null}>
          <button type="button" className={OLD_LINK_CLASS}>
            View details
          </button>
        </Variant>
        <Variant name="New: link" props='<Button variant="link">' value={null}>
          <Button variant="link">View details</Button>
        </Variant>
        <Variant name="Old: danger, hand-written red" props="<button className={...}>" value={null}>
          <button type="button" className={OLD_DANGER_CLASS}>
            Delete
          </button>
        </Variant>
        <Variant name="New: destructive" props='<Button variant="destructive">' value={null}>
          <Button variant="destructive">Delete</Button>
        </Variant>
      </NotMigrated>
    </>
  );
}
