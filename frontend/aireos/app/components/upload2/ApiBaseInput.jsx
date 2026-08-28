'use client';

// Editable backend API base URL. The value is used for every request; trailing
// slashes are stripped when requests are built (see normalizeBaseUrl).
export default function ApiBaseInput({ apiBase, onApiBaseChange }) {
  return (
    <section className="mb-8 rounded-lg border border-lavander bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="font-serif text-2xl text-deep-violet-blue">Connection</h2>
          <p className="text-sm text-deep-violet-blue/80">Requests are sent to this backend origin.</p>
        </div>
        <label className="flex w-full flex-col gap-1 md:w-72">
          <span className="text-xs font-medium uppercase tracking-wide text-deep-violet-blue/60">
            API base
          </span>
          <input
            type="text"
            value={apiBase}
            onChange={(event) => onApiBaseChange(event.target.value)}
            spellCheck={false}
            className="w-full rounded-md border border-lavander bg-cream px-3 py-2 font-mono text-sm text-deep-violet-blue focus:border-violet focus:outline-none"
          />
        </label>
      </div>
    </section>
  );
}