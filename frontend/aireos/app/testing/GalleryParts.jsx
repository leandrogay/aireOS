// The card and caption every gallery on the testing page lays its variants out in.

/**
 * @param {{ title: string, note?: string, children: React.ReactNode }} props
 */
export function Section({ title, note, children }) {
  return (
    <section className="mb-4 rounded-lg border border-lavander bg-white p-4 shadow-sm">
      <h2 className="font-serif text-lg text-deep-violet-blue">{title}</h2>
      {note && <p className="mb-3 text-xs text-deep-violet-blue/60">{note}</p>}
      <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
    </section>
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
