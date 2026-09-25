'use client';

import Link from 'next/link';
import StatusBadge from '../ui/StatusBadge';
import { formatFileSize } from '../../utils/fileInspect';
import { STAGES } from '../../utils/uploadFlow';

const action =
  'rounded-md border px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-60';
const secondaryAction = `${action} border-violet bg-white text-deep-violet-blue hover:bg-lavander`;
const primaryAction = `${action} border-deep-violet-blue bg-deep-violet-blue text-white hover:opacity-90`;

function formatDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function StageProgress({ stage }) {
  const currentIndex = STAGES.findIndex((entry) => entry.key === stage);

  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-deep-violet-blue/70">
      {STAGES.map((entry, index) => (
        <li key={entry.key} className="flex items-center gap-2">
          {index > 0 && <span aria-hidden="true">→</span>}
          <span
            className={
              index === currentIndex
                ? 'font-semibold text-deep-violet-blue'
                : index < currentIndex
                  ? 'text-deep-violet-blue/70 line-through decoration-deep-violet-blue/30'
                  : 'text-deep-violet-blue/40'
            }
          >
            {entry.label}
          </span>
        </li>
      ))}
    </ol>
  );
}

function TransformedPreview({ processing }) {
  const rows = processing?.preview || [];
  if (!rows.length) return null;

  // Wide output (20 target fields) in a narrow row: show the first handful and
  // say how many were left off, rather than a table nobody can read.
  const columns = (processing.columns || Object.keys(rows[0])).slice(0, 6);
  const hidden = (processing.columns || []).length - columns.length;

  return (
    <div className="mt-3">
      <p className="mb-1.5 text-xs font-semibold text-deep-violet-blue">
        Preview after transformation
        {processing.rows_mapped != null && (
          <span className="font-normal text-deep-violet-blue/70">
            {' '}
            — {processing.rows_mapped.toLocaleString()} rows mapped
            {processing.rows_rejected ? `, ${processing.rows_rejected} rejected` : ''}
          </span>
        )}
      </p>
      <div className="overflow-x-auto rounded-md border border-lavander">
        <table className="min-w-full text-left text-xs">
          <thead className="bg-lavander text-deep-violet-blue">
            <tr>
              {columns.map((column) => (
                <th key={column} className="px-2.5 py-1.5 font-medium">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="text-deep-violet-blue">
            {rows.slice(0, 3).map((row, rowIndex) => (
              <tr key={rowIndex} className="border-t border-lavander">
                {columns.map((column) => (
                  <td key={column} className="px-2.5 py-1.5 whitespace-nowrap">
                    {row[column] == null || row[column] === '' ? '—' : String(row[column])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hidden > 0 && (
        <p className="mt-1 text-xs text-deep-violet-blue/60">
          + {hidden} more target field{hidden === 1 ? '' : 's'}
        </p>
      )}
      {processing.rejection_summary && (
        <p className="mt-1.5 text-xs text-amber-900">{processing.rejection_summary}</p>
      )}
    </div>
  );
}

/**
 * One file, from selection through to its outcome.
 *
 * @param {{
 *   item: object,
 *   onRemove: (id: string) => void,
 *   onRetry: (id: string) => void,
 *   onResolveDuplicate: (id: string, choice: 'skip' | 'replace' | 'keep') => void,
 * }} props
 */
export default function UploadFileRow({ item, onRemove, onRetry, onResolveDuplicate }) {
  const { file, status, rejection, stage, outcome, busy } = item;

  return (
    <li className="rounded-lg border border-lavander bg-white p-3.5 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-deep-violet-blue">{file.name}</p>
          <p className="text-xs text-deep-violet-blue/70">{formatFileSize(file.size)}</p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {status === 'ready' && <StatusBadge tone="ready">Ready</StatusBadge>}
          {status === 'rejected' && <StatusBadge tone="failed">Rejected</StatusBadge>}
          {status === 'processing' && <StatusBadge tone="busy">Processing</StatusBadge>}
          {outcome?.kind === 'mapped' && <StatusBadge tone="ready">Done</StatusBadge>}
          {outcome?.kind === 'needs_review' && (
            <StatusBadge tone="review">Needs review</StatusBadge>
          )}
          {outcome?.kind === 'duplicate' && <StatusBadge tone="duplicate">Duplicate</StatusBadge>}
          {outcome?.kind === 'failed' && <StatusBadge tone="failed">Failed</StatusBadge>}
          {outcome?.kind === 'skipped' && <StatusBadge tone="neutral">Skipped</StatusBadge>}

          {(status === 'ready' || status === 'rejected') && (
            <button
              type="button"
              onClick={() => onRemove(item.id)}
              className={secondaryAction}
              aria-label={`Remove ${file.name}`}
            >
              Remove
            </button>
          )}
        </div>
      </div>

      {status === 'rejected' && rejection && (
        <p className="mt-2 text-xs text-red-700">{rejection}</p>
      )}

      {status === 'processing' && (
        <div className="mt-2.5">
          <StageProgress stage={stage} />
        </div>
      )}

      {outcome?.kind === 'mapped' && (
        <div className="mt-2.5">
          <p className="text-xs text-deep-violet-blue">
            Matched{' '}
            <span className="font-medium">{outcome.name || 'a stored mapping'}</span>
            {outcome.vendor && <> · {outcome.vendor}</>}
          </p>
          <TransformedPreview processing={outcome.processing} />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {outcome.mappingId && (
              <Link href={`/mappings/${outcome.mappingId}`} className={secondaryAction}>
                View mapping
              </Link>
            )}
            <Link href="/mappings" className={secondaryAction}>
              Use a different mapping
            </Link>
          </div>
        </div>
      )}

      {outcome?.kind === 'needs_review' && (
        <div className="mt-2.5">
          <p className="text-xs text-deep-violet-blue">
            {outcome.why === 'partial' ? (
              <>
                The columns nearly match{' '}
                <span className="font-medium">
                  {outcome.matched?.name || 'a stored mapping'}
                </span>
                {outcome.matched?.vendor && <> ({outcome.matched.vendor})</>} — but not exactly,
                so nothing was applied.
              </>
            ) : (
              'A new file layout. A proposed mapping is waiting for review.'
            )}
          </p>

          {outcome.matched && (
            <ul className="mt-1.5 space-y-0.5 text-xs text-deep-violet-blue/80">
              {!!outcome.matched.extra_columns?.length && (
                <li>Columns this file adds: {outcome.matched.extra_columns.join(', ')}</li>
              )}
              {!!outcome.matched.missing_columns?.length && (
                <li>Columns the mapping expects: {outcome.matched.missing_columns.join(', ')}</li>
              )}
            </ul>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {outcome.mappingId && (
              <>
                <Link href={`/mappings/${outcome.mappingId}`} className={primaryAction}>
                  Review mapping
                </Link>
                <Link href={`/mappings/${outcome.mappingId}`} className={secondaryAction}>
                  View mapping
                </Link>
              </>
            )}
          </div>
        </div>
      )}

      {outcome?.kind === 'duplicate' && (
        <div className="mt-2.5">
          <p className="text-xs text-deep-violet-blue">
            {outcome.matchedOn === 'content'
              ? 'The same file contents are already in the bucket'
              : 'A file with this name was already uploaded'}
            {outcome.existingFilename && outcome.existingFilename !== file.name && (
              <> as <span className="font-medium">{outcome.existingFilename}</span></>
            )}
            {outcome.uploadedAt && <> on {formatDate(outcome.uploadedAt)}</>}.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => onResolveDuplicate(item.id, 'skip')}
              className={secondaryAction}
            >
              Skip
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onResolveDuplicate(item.id, 'replace')}
              className={primaryAction}
            >
              Replace
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onResolveDuplicate(item.id, 'keep')}
              className={secondaryAction}
            >
              Upload anyway
            </button>
          </div>
        </div>
      )}

      {outcome?.kind === 'failed' && (
        <div className="mt-2.5">
          <p className="text-xs text-red-700">{outcome.error}</p>
          <div className="mt-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => onRetry(item.id)}
              className={secondaryAction}
            >
              Retry
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
