'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { primaryButtonClass, secondaryButtonClass } from '@/components/inventory/formStyles';
import LoadFileRow from '@/components/upload/LoadFileRow';
import LoadResult from '@/components/upload/LoadResult';
import { loadUploads, previewLoad } from '@/app/services/uploadApi';
import { loadButtonLabel, loadOutcome, loadTotals, outcomeTitle, totalsSentence } from '@/app/utils/loadPreview';

/**
 * Saving is switched off in this environment, said before the click: the
 * button only runs the check, so the person should know that up front.
 */
function StorageOffNotice() {
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      <AlertTriangle aria-hidden="true" className="mt-px size-4 shrink-0" />
      <p>
        <span className="font-medium">Saving is off in this environment.</span> The files are read with the approved
        mapping, but no sales rows are written (<span className="font-mono">CLOUD_SQL_LOAD_ENABLED</span> is off).
      </p>
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
  const outcome = response ? loadOutcome(response) : null;

  return (
    <div className="rounded-lg border border-lavander bg-white shadow-sm">
      {/* ==== Header ==== */}
      <div className="border-b border-lavander py-3 pl-4 pr-12">
        <h2 className="font-serif text-xl text-deep-violet-blue">
          {outcome ? outcomeTitle(outcome, reload) : reload ? 'Reload with the new version' : 'Load into sales data'}
        </h2>
        {!outcome && (
          <p className="mt-0.5 text-xs text-deep-violet-blue/75">
            Loading writes these files into the sales data the dashboard and inventory read. It can&apos;t be undone
            from aireOS, so check what it will change first.
          </p>
        )}
      </div>

      {outcome ? (
        <LoadResult outcome={outcome} />
      ) : (
        <>
          <div className="max-h-[60vh] space-y-2 overflow-y-auto px-4 py-4">
            {storageOff && <StorageOffNotice />}

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
                {totalsSentence(totals, storageOff)} Figures are as of now; the load checks every file again.
              </p>
            )}
            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="outline" disabled={loading} onClick={onClose} className={secondaryButtonClass}>
                Cancel
              </Button>
              <Button type="button" disabled={loading || !totals?.files} onClick={handleLoad} className={primaryButtonClass}>
                {loading && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
                {loading ? 'Loading…' : loadButtonLabel(totals?.files || 0, reload, storageOff)}
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
