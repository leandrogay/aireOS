'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, CheckCircle2, Info, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { primaryButtonClass, secondaryButtonClass } from '@/components/inventory/formStyles';
import LoadFileRow from '@/components/upload/LoadFileRow';
import { loadUploads, previewLoad } from '@/app/services/uploadApi';
import { loadButtonLabel, loadOutcome, loadTotals, totalsSentence } from '@/app/utils/loadPreview';
import { cn } from '@/lib/utils';

function plural(count, one, many) {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

/** What the load did, once it has answered. */
function LoadDone({ response, onClose }) {
  const outcome = loadOutcome(response);

  return (
    <div className="space-y-3 px-4 py-4 text-sm text-deep-violet-blue">
      {outcome.loaded.length > 0 && (
        <p className="flex items-start gap-2">
          <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-green-600" />
          Loaded {plural(outcome.loaded.length, 'file', 'files')} · {plural(outcome.rows, 'sales row', 'sales rows')}
        </p>
      )}
      {outcome.storageOff && (
        <p className="text-xs text-amber-900">
          Loading into the database is switched off here, so the files were read but no sales were saved.
        </p>
      )}
      {outcome.failed.length > 0 && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          <p className="font-medium">{plural(outcome.failed.length, 'file', 'files')} could not be loaded</p>
          <ul className="mt-1 space-y-1">
            {outcome.failed.map((item) => (
              <li key={item.blob_path}>
                <span className="font-mono">{item.filename || item.blob_path}</span> — {item.error}
              </li>
            ))}
          </ul>
          <p className="mt-2">Nothing from these files was saved. They can be loaded again from Recent uploads.</p>
        </div>
      )}
      <div className="flex items-center justify-end gap-2 pt-1">
        {outcome.loaded.length > 0 && (
          <Link href="/dashboard" className={cn(secondaryButtonClass, 'inline-flex h-8 items-center gap-1 rounded-md border px-3 text-sm')}>
            View Sales Dashboard
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        )}
        <Button type="button" onClick={onClose} className={primaryButtonClass}>
          Done
        </Button>
      </div>
    </div>
  );
}

/**
 * The confirmation itself, mounted fresh on every open: preview, choose,
 * load, then what happened.
 */
function LoadConfirmForm({ pathsKey, reload, onClose, onLoaded, onPendingChange }) {
  const [files, setFiles] = useState(null);
  const [previewError, setPreviewError] = useState('');
  const [selected, setSelected] = useState(new Set());
  // The one file whose rows are open, so a long list never becomes a wall of
  // tables. The first file starts open, so the rows are seen without a click.
  const [openPath, setOpenPath] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [response, setResponse] = useState(null);

  // The dry run, once per open. Keyed on the joined paths, so a new array
  // with the same files does not run it again.
  useEffect(() => {
    let cancelled = false;
    previewLoad(pathsKey.split('\n'))
      .then((result) => {
        if (cancelled) return;
        setFiles(result);
        // Every file that can be loaded starts ticked: the person came here
        // to load them, and unticks the ones they don't want.
        setSelected(new Set(result.filter((file) => file.success).map((file) => file.blob_path)));
        setOpenPath(result.find((file) => file.success)?.blob_path || null);
      })
      .catch((error) => {
        if (!cancelled) setPreviewError(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, [pathsKey]);

  function toggle(blobPath) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(blobPath)) next.delete(blobPath);
      else next.add(blobPath);
      return next;
    });
  }

  async function handleLoad() {
    setLoading(true);
    setLoadError('');
    onPendingChange(true);
    try {
      const result = await loadUploads([...selected]);
      setResponse(result);
      onLoaded(result);
    } catch (error) {
      setLoadError(error.message);
    } finally {
      setLoading(false);
      onPendingChange(false);
    }
  }

  const totals = files ? loadTotals(files, selected) : null;
  const storageOff = files?.some((file) => file.success && file.preview?.storage_enabled === false);

  return (
    <div className="rounded-lg border border-lavander bg-white shadow-sm">
      {/* ==== Header ==== */}
      <div className="border-b border-lavander py-3 pl-4 pr-12">
        <h2 className="font-serif text-xl text-deep-violet-blue">
          {reload ? 'Reload with the new version' : 'Load into sales data'}
        </h2>
        <p className="mt-0.5 text-xs text-deep-violet-blue/65">
          Loading writes these files into the sales data the dashboard and inventory read. It can&apos;t be undone
          from aireOS, so check what it will change first.
        </p>
      </div>

      {response ? (
        <LoadDone response={response} onClose={onClose} />
      ) : (
        <>
          <div className="max-h-[60vh] space-y-2 overflow-y-auto px-4 py-4">
            {!files && !previewError && (
              <p role="status" className="flex items-center gap-2 text-sm text-deep-violet-blue/70">
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                Working out what loading would change…
              </p>
            )}

            {previewError && (
              <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                Couldn&apos;t work out what loading would change: {previewError}
              </p>
            )}

            {files && !files.length && <p className="text-sm text-deep-violet-blue/70">There are no files to load.</p>}

            {files?.length > 0 && (
              <ul className="space-y-2">
                {files.map((file) => (
                  <LoadFileRow
                    key={file.blob_path}
                    file={file}
                    checked={selected.has(file.blob_path)}
                    open={openPath === file.blob_path}
                    onToggle={() => toggle(file.blob_path)}
                    onOpen={() => setOpenPath((current) => (current === file.blob_path ? null : file.blob_path))}
                    disabled={loading}
                  />
                ))}
              </ul>
            )}

            {storageOff && (
              <p className="flex items-start gap-1 text-[11px] text-deep-violet-blue/60">
                <Info aria-hidden="true" className="mt-px size-3 shrink-0" />
                Loading into the database is switched off here, so nothing will be saved and existing rows can&apos;t
                be compared.
              </p>
            )}

            {loadError && (
              <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                {loadError}
              </p>
            )}
          </div>

          {/* ==== Actions ==== */}
          <div className="rounded-b-lg border-t border-lavander bg-cream/40 px-4 py-3">
            {totals?.files > 0 && (
              <p aria-live="polite" className="mb-2 text-xs text-deep-violet-blue">
                {totalsSentence(totals)} Figures are as of now; the load checks every file again.
              </p>
            )}
            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="outline" disabled={loading} onClick={onClose} className={secondaryButtonClass}>
                Cancel
              </Button>
              <Button type="button" disabled={loading || !totals?.files} onClick={handleLoad} className={primaryButtonClass}>
                {loading && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
                {loading ? 'Loading…' : loadButtonLabel(totals?.files || 0, reload)}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The confirmed step between an approved mapping and its data in sell-out:
 * a dry run of each file (POST /api/uploads/load/preview), the person ticks
 * the ones to load, and only then POST /api/uploads/load. Escape, the
 * backdrop and Cancel close it with nothing loaded, except while a load is in
 * flight.
 *
 * @param {{
 *   open: boolean,
 *   blobPaths: string[],
 *   reload?: boolean,
 *   onClose: () => void,
 *   onLoaded?: (response: object) => void,
 * }} props
 */
export default function LoadConfirmDialog({ open, blobPaths, reload = false, onClose, onLoaded = () => {} }) {
  const [pending, setPending] = useState(false);

  function close() {
    if (!pending) onClose();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent
        aria-label={reload ? 'Reload with the new version' : 'Load into sales data'}
        className="bg-transparent p-0 ring-0 sm:max-w-3xl"
      >
        {open && (
          <LoadConfirmForm
            pathsKey={blobPaths.join('\n')}
            reload={reload}
            onClose={close}
            onLoaded={onLoaded}
            onPendingChange={setPending}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
