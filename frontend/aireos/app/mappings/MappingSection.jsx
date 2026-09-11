'use client';

// Groups mappings by state (pending / confirmed / builtin) under a labeled,
// color-coded header, so the three kinds read as distinct groups instead of
// an undifferentiated stack of identical-looking cards.
export const MappingSection = ({ section, count, children }) => {
  return (
    <section className="rounded-lg border border-lavander bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-2 border-b border-lavander px-5 py-4">
        <span
          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${section.badgeClass}`}
        >
          {section.label}
        </span>
        <span className="text-xs font-medium text-deep-violet-blue/60">{count}</span>
        <p className="w-full text-sm text-deep-violet-blue/70 sm:w-auto sm:flex-1">{section.description}</p>
      </div>
      <div className="space-y-3 p-5">{children}</div>
    </section>
  );
};