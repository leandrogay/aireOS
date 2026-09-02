'use client';

export default function FilterBadge({ label, onClear }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-violet bg-lavander px-2.5 py-0.5 text-xs font-medium text-deep-violet-blue">
      {label}
      <button
        type="button"
        onClick={onClear}
        aria-label={`Clear filter: ${label}`}
        className="rounded-full leading-none text-deep-violet-blue/70 hover:text-deep-violet-blue"
      >
        ×
      </button>
    </span>
  );
}
