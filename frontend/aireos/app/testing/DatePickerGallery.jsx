'use client';

import { useState } from 'react';

import { Calendar } from '@/components/ui/calendar';
import DatePicker from '@/components/ui/DatePicker';
import DateRangePicker from '@/components/ui/DateRangePicker';
import RangeDatePicker from '@/components/ui/RangeDatePicker';
import { filterLabelClass } from '@/components/inventory/InventoryChrome';
import { labelClass } from '@/components/ui/formStyles';
import { parseYmd, toYmd } from '@/app/utils/datePicker';
import { singaporeToday } from '@/lib/singaporeTime';

import { Section, Variant } from './GalleryParts';

// A living reference for the date-picker kit; see app/testing/page.js.

// Which component to reach for; keep in step with ui/DatePicker and ui/RangeDatePicker.
const GUIDE = [
  ['Pick one day', 'DatePicker', 'value (YYYY-MM-DD), onChange, variant, min / max'],
  ['Pick a start and end day', 'RangeDatePicker', 'start, end, onChange({ start, end }), variant, min / max'],
  ['Pick one month', 'MonthDropdown', 'value (YYYY-MM), onChange — see the dropdown kit above'],
  ['A day grid inside your own panel', 'Calendar', 'react-day-picker props (mode, selected, onSelect…)'],
];

export default function DatePickerGallery() {
  const [days, setDays] = useState({
    field: '2026-03-12',
    input: '2026-03-12',
    filter: '',
    compact: '',
    bounded: '2026-06-15',
    clearable: '2026-09-01',
    invalid: '',
  });
  const [ranges, setRanges] = useState({
    field: { start: '2026-03-12', end: '2026-04-30' },
    input: { start: '2026-03-12', end: '2026-04-30' },
    filter: { start: '', end: '' },
    compact: { start: '', end: '' },
    bounded: { start: '2026-06-01', end: '2026-06-15' },
    required: { start: '', end: '' },
  });
  const [legacy, setLegacy] = useState({ start: '2026-03-12', end: '2026-04-30' });
  const [calendarDay, setCalendarDay] = useState(toYmd(singaporeToday()));

  const setDay = (key) => (value) => setDays((prev) => ({ ...prev, [key]: value }));
  const setRange = (key) => (range) => setRanges((prev) => ({ ...prev, [key]: range }));

  return (
    <div>
      <section className="mb-4 rounded-lg border border-lavander bg-white p-4 shadow-sm">
        <h2 className="font-serif text-lg text-deep-violet-blue">Date pickers</h2>
        <p className="mb-3 text-xs text-deep-violet-blue/60">
          Built on the shadcn Calendar (ui/calendar, react-day-picker) in the AIRE colours, inside the same panel as the
          dropdowns. Weeks start on Monday and today (Singapore) is bold violet. Dates go in and out as YYYY-MM-DD.
        </p>
        <div className="overflow-x-auto rounded-md border border-lavander">
          <table className="w-full text-left text-xs text-deep-violet-blue">
            <thead className="bg-cream">
              <tr className="border-b border-lavander">
                <th className="px-2.5 py-2 font-semibold">I need to…</th>
                <th className="px-2.5 py-2 font-semibold">Use</th>
                <th className="px-2.5 py-2 font-semibold">Main props</th>
              </tr>
            </thead>
            <tbody>
              {GUIDE.map(([need, component, props]) => (
                <tr key={component} className="border-b border-lavander/80 last:border-b-0">
                  <td className="px-2.5 py-2">{need}</td>
                  <td className="px-2.5 py-2 font-mono">{component}</td>
                  <td className="px-2.5 py-2 font-mono text-deep-violet-blue/70">{props}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-deep-violet-blue/70">
          <span className="font-medium">variant</span> sets how a date is entered:{' '}
          <span className="font-mono">button</span> (default) only opens the calendar,{' '}
          <span className="font-mono">input</span> also lets you type dd/mm/yyyy. The button variant takes the dropdown{' '}
          <span className="font-mono">look</span> (field / filter / compact).
        </p>
      </section>

      <Section title="DatePicker — pick a day" note="Closes on pick. Month and year dropdowns in the caption jump far quickly.">
        <Variant name="Button, field (forms)" props={'variant="button" look="field"'} value={days.field}>
          <label className={labelClass} htmlFor="gallery-date-field">Start date</label>
          <DatePicker id="gallery-date-field" value={days.field} onChange={setDay('field')} />
        </Variant>
        <Variant name="Typed (input)" props={'variant="input"'} value={days.input}>
          <label className={labelClass} htmlFor="gallery-date-input">Start date</label>
          <DatePicker id="gallery-date-input" variant="input" value={days.input} onChange={setDay('input')} />
        </Variant>
        <Variant name="Filter (FilterBar)" props={'look="filter" clearable'} value={days.filter}>
          <DatePicker look="filter" clearable value={days.filter} onChange={setDay('filter')} placeholder="Any date" />
        </Variant>
        <Variant name="Compact (inventory filters)" props={'look="compact" clearable'} value={days.compact}>
          <span className={filterLabelClass}>Effective from</span>
          <DatePicker look="compact" clearable value={days.compact} onChange={setDay('compact')} placeholder="Any date" />
        </Variant>
        <Variant name="Bounded" props={'min="2026-06-01" max="2026-07-20"'} value={days.bounded}>
          <div className="space-y-2">
            <DatePicker value={days.bounded} onChange={setDay('bounded')} min="2026-06-01" max="2026-07-20" />
            <DatePicker variant="input" value={days.bounded} onChange={setDay('bounded')} min="2026-06-01" max="2026-07-20" />
          </div>
        </Variant>
        <Variant name="Clearable" props="clearable" value={days.clearable}>
          <DatePicker clearable value={days.clearable} onChange={setDay('clearable')} />
        </Variant>
        <Variant name="Invalid / disabled" props="invalid · disabled" value={days.invalid}>
          <div className="space-y-2">
            <DatePicker invalid value={days.invalid} onChange={setDay('invalid')} placeholder="Required" />
            <DatePicker variant="input" invalid value={days.invalid} onChange={setDay('invalid')} />
            <DatePicker disabled value="2026-03-12" onChange={() => {}} />
            <DatePicker variant="input" disabled value="2026-03-12" onChange={() => {}} />
          </div>
        </Variant>
      </Section>

      <Section
        title="RangeDatePicker — pick a start and end day"
        note="Two months (one on a phone). First click the start, second the end; nothing changes until Apply."
      >
        <Variant name="Button, field (forms)" props={'variant="button" look="field"'} value={ranges.field}>
          <label className={labelClass} htmlFor="gallery-range-field">Promotion period</label>
          <RangeDatePicker id="gallery-range-field" {...ranges.field} onChange={setRange('field')} />
        </Variant>
        <Variant name="Typed (input)" props={'variant="input"'} value={ranges.input}>
          <label className={labelClass} htmlFor="gallery-range-input">Promotion period</label>
          <RangeDatePicker id="gallery-range-input" variant="input" {...ranges.input} onChange={setRange('input')} />
        </Variant>
        <Variant name="Filter (FilterBar)" props={'look="filter"'} value={ranges.filter}>
          <RangeDatePicker look="filter" {...ranges.filter} onChange={setRange('filter')} placeholder="Any period" />
        </Variant>
        <Variant name="Compact (forecast / inventory filters)" props={'look="compact"'} value={ranges.compact}>
          <span className={filterLabelClass}>Period</span>
          <RangeDatePicker look="compact" {...ranges.compact} onChange={setRange('compact')} placeholder="Any period" />
        </Variant>
        <Variant name="Bounded" props={'min="2026-05-10" max="2026-07-20"'} value={ranges.bounded}>
          <div className="space-y-2">
            <RangeDatePicker {...ranges.bounded} onChange={setRange('bounded')} min="2026-05-10" max="2026-07-20" />
            <RangeDatePicker variant="input" {...ranges.bounded} onChange={setRange('bounded')} min="2026-05-10" max="2026-07-20" />
          </div>
        </Variant>
        <Variant name="Required, no Clear" props={'clearable={false} invalid'} value={ranges.required}>
          <RangeDatePicker
            clearable={false}
            invalid={!ranges.required.start}
            {...ranges.required}
            onChange={setRange('required')}
            placeholder="Required"
          />
        </Variant>
        <Variant name="Disabled" props="disabled" value={null}>
          <div className="space-y-2">
            <RangeDatePicker disabled start="2026-03-12" end="2026-04-30" onChange={() => {}} />
            <RangeDatePicker variant="input" disabled start="2026-03-12" end="2026-04-30" onChange={() => {}} />
          </div>
        </Variant>
      </Section>

      <Section title="Calendar — the primitive" note="ui/calendar on its own, for a panel that needs a day grid inside other content.">
        <Variant name="Single, inline" props={'mode="single" weekStartsOn={1}'} value={calendarDay}>
          <Calendar
            mode="single"
            weekStartsOn={1}
            today={singaporeToday()}
            selected={parseYmd(calendarDay)}
            defaultMonth={parseYmd(calendarDay)}
            onSelect={(_selected, day) => setCalendarDay(toYmd(day))}
            className="rounded-md border border-lavander"
          />
        </Variant>
      </Section>

      <Section
        title="Before — the pickers these replace"
        note="For comparison while pages migrate: ui/DateRangePicker (two typed fields, the browser's own calendar) is on the promotion form, Forecast filters and Scenario promotion editor; SKU forms use raw date inputs."
      >
        <Variant name="ui/DateRangePicker" props="start, end, onStartChange, onEndChange" value={legacy}>
          <DateRangePicker
            start={legacy.start}
            end={legacy.end}
            onStartChange={(start) => setLegacy((prev) => ({ ...prev, start }))}
            onEndChange={(end) => setLegacy((prev) => ({ ...prev, end }))}
          />
        </Variant>
      </Section>
    </div>
  );
}
