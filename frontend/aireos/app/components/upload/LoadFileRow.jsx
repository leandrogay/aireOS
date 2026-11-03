'use client';

import { AlertTriangle, ChevronRight, XCircle } from 'lucide-react';

import OutputPreview from '@/components/mappings/OutputPreview';
import {
  LOAD_PREVIEW_FIELDS,
  fileWarnings,
  overwrittenRows,
  periodLabel,
  retailerNames,
} from '@/app/utils/loadPreview';
import { cn } from '@/lib/utils';

function plural(count, one, many) {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

/**
 * The detail behind a file's warnings, said in full where the row only names
 * them: which files' rows it overwrites, what it replaces, why rows are skipped.
 */
function FileWarnings({ file }) {
  const preview = file.preview;
  const overwritten = overwrittenRows(file);
  if (!overwritten && !preview.rows_replaced && !preview.rows_rejected) return null;

  return (
    <div className="space-y-1 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-2 text-xs text-amber-900">
      {overwritten > 0 && (
        <div>
          <p className="flex items-center gap-1 font-medium">
            <AlertTriangle aria-hidden="true" className="size-3.5 shrink-0" />
            Overwrites {plural(overwritten, 'row', 'rows')} other files loaded
          </p>
          {preview.overwrites.map((item) => (
            <p key={item.source_file} className="pl-4.5">
              <span className="font-mono">{item.source_file}</span> — {plural(item.rows, 'row', 'rows')}
            </p>
          ))}
        </div>
      )}
      {preview.rows_replaced > 0 && (
        <p>Replaces {plural(preview.rows_replaced, 'row', 'rows')} loaded earlier from a file named “{file.filename}”.</p>
      )}
      {preview.rows_rejected > 0 && (
        <p>{preview.rejection_summary || `${plural(preview.rows_rejected, 'row', 'rows')} skipped.`}</p>
      )}
    </div>
  );
}

/**
 * One file in the confirmation, as a row that opens. Closed, it is one line
 * of figures and any warning, so ten files still fit on a screen; open, it
 * shows the sales rows the load would write -- the same table as the review
 * screen's "Sample sales rows" -- and the full warnings. Ticking and opening
 * are separate controls: looking at a file never changes what is loaded.
 *
 * @param {{
 *   file: object,
 *   checked: boolean,
 *   open: boolean,
 *   onToggle: () => void,
 *   onOpen: () => void,
 *   disabled: boolean,
 * }} props
 */
export default function LoadFileRow({ file, checked, open, onToggle, onOpen, disabled }) {
  const preview = file.preview;

  if (!file.success) {
    return (
      <li className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
        <p className="flex items-center gap-1.5 font-medium">
          <XCircle aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="truncate">{file.filename || file.blob_path}</span>
        </p>
        <p className="mt-0.5 pl-5">Can&apos;t be loaded: {file.error}</p>
      </li>
    );
  }

  const warnings = fileWarnings(file);
  const retailers = retailerNames(preview);
  const panelId = `load-file-${file.blob_path}`;

  return (
    <li className={cn('rounded-md border border-lavander bg-white', open && 'border-deep-violet-blue/30')}>
      <div className="flex items-start gap-2 px-3 py-2">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={onToggle}
          aria-label={`Load ${file.filename}`}
          className="mt-1 size-4 shrink-0 accent-deep-violet-blue"
        />
        <button
          type="button"
          onClick={onOpen}
          aria-expanded={open}
          aria-controls={panelId}
          className="flex min-w-0 flex-1 items-start gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-deep-violet-blue"
        >
          <span className={cn('min-w-0 flex-1 text-xs text-deep-violet-blue', !checked && 'opacity-60')}>
            <span className="flex items-center gap-2">
              <span className="truncate text-sm font-medium">{file.filename}</span>
              {file.reload && (
                <span className="shrink-0 rounded-full border border-lavander bg-cream px-1.5 text-[10px]">Reload</span>
              )}
            </span>
            <span className="block text-deep-violet-blue/70">
              {plural(preview.rows_to_store, 'sales row', 'sales rows')} · {periodLabel(preview)} ·{' '}
              {plural(preview.sku_count, 'SKU', 'SKUs')}
            </span>
            {warnings.length > 0 && (
              <span className="mt-0.5 flex items-center gap-1 text-amber-900">
                <AlertTriangle aria-hidden="true" className="size-3 shrink-0" />
                {warnings.join(' · ')}
              </span>
            )}
          </span>
          <span className="flex shrink-0 items-center gap-0.5 pt-0.5 text-[11px] font-medium text-deep-violet-blue/70">
            {open ? 'Hide' : 'Preview'}
            <ChevronRight aria-hidden="true" className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
          </span>
        </button>
      </div>

      {open && (
        <div id={panelId} className="space-y-2 border-t border-lavander px-3 py-2.5">
          <p className="text-xs text-deep-violet-blue/70">
            {file.mapping_name} · version {file.mapping_version}
            {file.reload && file.loaded_version && ` (loaded with version ${file.loaded_version})`}
            {retailers.length > 0 && (
              <>
                {' · '}
                <span className="font-mono text-[11px]">{retailers.join(', ')}</span>
              </>
            )}
          </p>
          <FileWarnings file={file} />
          {preview.preview?.length > 0 ? (
            <OutputPreview preview={preview} fields={LOAD_PREVIEW_FIELDS} total={preview.rows_to_store} />
          ) : (
            <p className="text-xs text-deep-violet-blue/70">No rows in this file can be stored.</p>
          )}
        </div>
      )}
    </li>
  );
}
