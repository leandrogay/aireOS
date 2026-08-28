import StatusPill from './StatusPill';
import MappingSection from './MappingSection';

// One uploaded file's outcome: name + status, then either an error or the file
// metadata (destination, size) followed by its proposed mapping.
export default function FileResultCard({ result, onConfirm, onDiscard }) {
  return (
    <div className="rounded-md border border-lavander bg-white">
      <div className="flex flex-wrap items-center gap-3 border-b border-lavander px-4 py-3">
        <span className="font-mono text-sm font-semibold text-deep-violet-blue">
          {result.filename}
        </span>
        <StatusPill variant={result.success ? 'ok' : 'bad'}>
          {result.success ? 'uploaded' : 'upload failed'}
        </StatusPill>
      </div>

      {!result.success ? (
        <div className="px-4 py-3">
          <p className="rounded-md border border-red-200 bg-red-50 p-3 font-mono text-xs text-red-700">
            {result.error || 'Unknown error'}
          </p>
        </div>
      ) : (
        <div className="px-4 py-3">
          <dl className="mb-3 grid grid-cols-1 gap-x-3 gap-y-1 text-xs sm:grid-cols-[130px_1fr]">
            <dt className="font-mono uppercase tracking-wide text-deep-violet-blue/60">destination</dt>
            <dd className="break-all font-mono text-deep-violet-blue">{result.destination || '—'}</dd>
            <dt className="font-mono uppercase tracking-wide text-deep-violet-blue/60">size</dt>
            <dd className="font-mono text-deep-violet-blue">
              {result.size_bytes != null ? `${result.size_bytes.toLocaleString()} bytes` : '—'}
            </dd>
          </dl>

          {result.mapping ? (
            <MappingSection mapping={result.mapping} onConfirm={onConfirm} onDiscard={onDiscard} />
          ) : (
            <p className="text-sm text-deep-violet-blue/60">No mapping returned for this file.</p>
          )}
        </div>
      )}
    </div>
  );
}