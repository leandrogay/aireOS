'use client';

import FileResultCard from './FileResultCard';

// The upload results panel: a summary line, any fatal upload error, and a card
// per file. Clear resets it. onConfirm/onDiscard pass through to each file's
// mapping review controls.
export default function ResultsPanel({ results, uploadError, onClear, onConfirm, onDiscard }) {
  const hasResults = results != null;

  return (
    <section className="mb-8 rounded-lg border border-lavander bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-serif text-2xl text-deep-violet-blue">Results</h2>
        <button
          type="button"
          onClick={onClear}
          className="rounded-md border border-lavander bg-white px-3 py-1.5 text-sm font-medium text-deep-violet-blue transition hover:bg-cream"
        >
          Clear
        </button>
      </div>

      {uploadError && (
        <p className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 font-mono text-xs text-red-700">
          {uploadError}
        </p>
      )}

      {!hasResults && !uploadError && (
        <p className="text-sm text-deep-violet-blue/60">Nothing uploaded yet.</p>
      )}

      {hasResults && (
        <>
          <p className="mb-4 text-sm text-deep-violet-blue/80">
            {results.uploaded ?? 0} uploaded, {results.failed ?? 0} failed.
          </p>
          <div className="space-y-3.5">
            {(results.results || []).map((fileResult, index) => (
              <FileResultCard
                key={`${fileResult.filename || 'file'}-${index}`}
                result={fileResult}
                onConfirm={onConfirm}
                onDiscard={onDiscard}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}