// The pieces every gallery on the testing page is laid out with. Each kit
// (Buttons, Dropdowns…) is a Category: a header that opens and closes, closed
// to start with so only the kit names show. Inside, everything is open. Every
// kit has the same blocks in the same order, with the same names:
//
//   WhichToUse    a table: what you need -> which component
//   Section...    the live components and their variants
//   NotMigrated   where the old version is still used (page, file), then the
//                 old and the new component side by side
//
// A Category is a native <details>: it works with the keyboard, needs no
// state, and its closed content stays mounted, so a control keeps what you
// picked in it while its kit is shut.

import { ChevronRight } from 'lucide-react';

/**
 * One kit (Buttons, Dropdowns, Date pickers, Toggles): a header that opens to
 * the kit's blocks, all of them open.
 *
 * @param {{ title: string, note?: string, children: React.ReactNode }} props
 */
export function Category({ title, note, children }) {
  return (
    <details className="mb-3 rounded-lg border border-lavander bg-cream/40">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-4 py-3 text-deep-violet-blue outline-none select-none hover:bg-cream focus-visible:ring-2 focus-visible:ring-violet [&::-webkit-details-marker]:hidden">
        {/* Written out in full: Tailwind only generates classes it finds whole in the source. */}
        <ChevronRight
          aria-hidden="true"
          className="size-5 shrink-0 text-deep-violet-blue/60 transition-transform [details[open]>summary_&]:rotate-90"
        />
        <h2 className="font-serif text-2xl">{title}</h2>
        {note && <span className="ml-1 hidden truncate text-xs text-deep-violet-blue/60 sm:inline">{note}</span>}
      </summary>
      <div className="px-3 pt-1 pb-1">{children}</div>
    </details>
  );
}

/**
 * A card with a title and an optional note, for free-form content. Use
 * Section when the body is a grid of variants.
 *
 * @param {{ title: string, note?: string, children: React.ReactNode }} props
 */
export function Panel({ title, note, children }) {
  return (
    <section className="mb-3 aire-card p-4">
      <h3 className="font-serif text-lg text-deep-violet-blue">{title}</h3>
      {note && <p className="mb-3 text-xs text-deep-violet-blue/60">{note}</p>}
      {children}
    </section>
  );
}

const VARIANT_GRID_CLASS = 'grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2 lg:grid-cols-4';

/**
 * A Panel whose body is a grid of Variants.
 *
 * @param {{ title: string, note?: string, children: React.ReactNode }} props
 */
export function Section({ title, note, children }) {
  return (
    <Panel title={title} note={note}>
      <div className={VARIANT_GRID_CLASS}>{children}</div>
    </Panel>
  );
}

/**
 * One variant: a caption saying which props it uses, the control, and the
 * value it currently holds.
 *
 * @param {{ name: string, props: string, value: unknown, children: React.ReactNode }} props
 */
export function Variant({ name, props, value, children }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium text-deep-violet-blue">{name}</p>
      <p className="mb-1.5 font-mono text-[10px] text-deep-violet-blue/50">{props}</p>
      {children}
      <p className="mt-1.5 truncate font-mono text-[10px] text-deep-violet-blue/60">
        value: {JSON.stringify(value)}
      </p>
    </div>
  );
}

/**
 * A plain table. The second column is the component or file, in mono.
 *
 * @param {{ head: string[], rows: string[][] }} props
 */
export function ReferenceTable({ head, rows }) {
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
            <tr key={row.join('|')} className="border-b border-lavander/80 align-top last:border-b-0">
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

/**
 * The first block of every kit: which component to reach for.
 *
 * @param {{
 *   rows: string[][],
 *   note?: string,
 *   children?: React.ReactNode,
 * }} props rows are [I need to…, Use, Main props]; children go under the table
 */
export function WhichToUse({ rows, note, children }) {
  return (
    <Panel title="Which to use" note={note}>
      <ReferenceTable head={['I need to…', 'Use', 'Main props']} rows={rows} />
      {children && <div className="mt-3 text-xs text-deep-violet-blue/70">{children}</div>}
    </Panel>
  );
}

/**
 * The last block of every kit, always called "Not migrated yet": where the
 * old version of the component is still used, then the old and the new one
 * side by side.
 *
 * @param {{
 *   rows: string[][],
 *   leaveAsIs?: string[][],
 *   children?: React.ReactNode,
 * }} props rows are [Page, File (components/), Uses now, Migrate to];
 * leaveAsIs rows are [Page, File (components/), Why it stays]; children are
 * Variants named "Old: …" and "New: …", old first
 */
export function NotMigrated({ rows, leaveAsIs, children }) {
  return (
    <Panel
      title="Not migrated yet"
      note="Pages that still use the old version. Move one to the kit when you're next working in its file, not as a standalone change, and remove its row here."
    >
      <ReferenceTable head={['Page', 'File (components/)', 'Uses now', 'Migrate to']} rows={rows} />

      {leaveAsIs && (
        <>
          <h4 className="mt-5 text-sm font-medium text-deep-violet-blue">Leave as is</h4>
          <p className="mb-2 text-xs text-deep-violet-blue/60">Look similar, but aren&apos;t the same thing; don&apos;t migrate these.</p>
          <ReferenceTable head={['Page', 'File (components/)', 'Why it stays']} rows={leaveAsIs} />
        </>
      )}

      {children && (
        <>
          <h4 className="mt-5 mb-2 text-sm font-medium text-deep-violet-blue">Old and new, side by side</h4>
          <div className={VARIANT_GRID_CLASS}>{children}</div>
        </>
      )}
    </Panel>
  );
}
