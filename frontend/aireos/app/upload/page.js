'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ListX } from 'lucide-react';
import PageLayout from '@/components/layout/PageLayout';
import { formatDateTime } from '@/lib/formatDate';
import { Button } from '@/components/ui/button';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Toast from '@/components/ui/Toast';
import Dropzone from '../components/upload/Dropzone';
import RejectedFiles from '../components/upload/RejectedFiles';
import UploadGroup from '../components/upload/UploadGroup';
import RecentUploads from '../components/upload/RecentUploads';
import LoadConfirmDialog from '../components/upload/LoadConfirmDialog';
import {
  MAX_FILES_PER_BATCH,
  UPLOAD_HISTORY_LIMIT,
  UPLOAD_HISTORY_MONTHS,
} from '../config/upload';
import { validateFile } from '../utils/fileInspect';
import { wasSaved } from '../utils/loadPreview';
import {
  STAGES,
  checkFromResult,
  filesLabel,
  groupFiles,
  isUploadable,
  outcomeFromResult,
  uploadBlocker,
  uploadOptionsFor,
} from '../utils/uploadFlow';
import {
  checkUpload,
  deleteUpload,
  uploadFile,
  fetchUploadHistory,
  rollbackUpload,
} from '../services/uploadApi';
import useConfirmAction from '@/hooks/useConfirmAction';
import useToast from '@/hooks/useToast';

let nextId = 0;
const makeId = () => `file-${(nextId += 1)}`;

// A file in the list moves through phases:
//   checking   dropped; POST /api/uploads/check is answering what would happen
//   ready      checked (or the check failed); waits for Upload
//   uploading  POST /api/uploads in flight
//   done       the upload answered; `outcome` says how it went. With
//              REQUIRE_LOAD_CONFIRMATION on, a known layout is done but
//              `ready_to_load` until someone confirms a load from its row.
// Files that cannot be uploaded never become rows; they are listed in the
// RejectedFiles alert instead.

export default function UploadPage() {
  const [items, setItems] = useState([]);
  const [rejections, setRejections] = useState([]);
  const [batchError, setBatchError] = useState('');
  const [history, setHistory] = useState([]);
  const [historyError, setHistoryError] = useState('');
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [rollbackReason, setRollbackReason] = useState('');
  const { toast, notify, dismissToast } = useToast();
  // The rows whose files the load confirmation is open for, or null.
  const [loadingIds, setLoadingIds] = useState(null);

  // Stage timers keyed by item id, so a file that finishes early stops
  // advancing its own labels without touching any other file's.
  const stageTimers = useRef(new Map());

  // Validation and checks are async, so by the time one answers the list has
  // moved on. This is what the duplicate-name and same-contents checks read.
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // Content hash of every checked file still waiting in the list, by id.
  // Written the moment a check answers, so two copies of one file whose
  // checks land together still find each other (itemsRef only catches up
  // after a render).
  const pendingHashes = useRef(new Map());

  const patchItem = useCallback((id, changes) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...changes } : item)),
    );
  }, []);

  const clearStageTimers = useCallback((id) => {
    (stageTimers.current.get(id) || []).forEach(clearTimeout);
    stageTimers.current.delete(id);
  }, []);

  useEffect(() => {
    const timers = stageTimers.current;
    return () => {
      timers.forEach((handles) => handles.forEach(clearTimeout));
      timers.clear();
    };
  }, []);

  // ---- History ----------------------------------------------------------

  const loadHistory = useCallback(async () => {
    setIsLoadingHistory(true);
    setHistoryError('');
    try {
      setHistory(
        await fetchUploadHistory({
          limit: UPLOAD_HISTORY_LIMIT,
          months: UPLOAD_HISTORY_MONTHS,
        }),
      );
    } catch (error) {
      setHistoryError(error.message);
    } finally {
      setIsLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    // Deferred a tick so the first render commits before the loading state
    // lands, rather than re-rendering the page on the way into it.
    Promise.resolve().then(loadHistory);
  }, [loadHistory]);

  const rollback = useConfirmAction({
    onConfirm: async (upload) => {
      try {
        const result = await rollbackUpload(
          upload.blob_path,
          rollbackReason.trim(),
        );
        notify(
          'warning',
          `${upload.filename} rolled back: ${result.rows_restored} restored, ${result.rows_removed} removed.`,
        );
        await loadHistory();
      } catch (error) {
        notify('error', error.message || 'Failed to roll back the upload.');
      }
    },
  });

  function requestRollback(upload) {
    setRollbackReason('');
    rollback.request(upload);
  }

  const deletion = useConfirmAction({
    onConfirm: async (upload) => {
      try {
        await deleteUpload(upload.blob_path);
        notify('deleted', `${upload.filename} was deleted from GCS.`);
        await loadHistory();
      } catch (error) {
        notify('error', error.message || 'Failed to delete the uploaded file.');
      }
    },
  });

  // ---- Selection and checking ---------------------------------------------

  // Takes a file out of the list and into the "can't be uploaded" alert.
  const rejectItem = useCallback((id, name, reason) => {
    pendingHashes.current.delete(id);
    setItems((prev) => prev.filter((item) => item.id !== id));
    setRejections((prev) => [...prev, { name, reason }]);
  }, []);

  // Asks the server what would happen to this file, so the row can say so
  // before anything is uploaded. A failed check does not hold the file back:
  // the upload runs every check again.
  const checkItem = useCallback(
    async (id, file) => {
      let check;
      try {
        check = checkFromResult(await checkUpload(file));
      } catch (error) {
        patchItem(id, { phase: 'ready', check: { failed: error.message } });
        return;
      }

      // Removed while it was being checked: nothing left to update.
      if (!itemsRef.current.some((item) => item.id === id)) return;

      if (check.error) {
        rejectItem(id, file.name, check.error);
        return;
      }

      // Two copies of one file under different names in one batch: keep the
      // one dropped first and turn the other away, rather than upload the
      // same data twice. Checks answer in any order, so "first" is list
      // order, not whichever check came back first -- unless the other copy
      // has already started uploading, which cannot be taken back.
      const twinId = [...pendingHashes.current].find(
        ([otherId, hash]) => otherId !== id && check.contentHash && hash === check.contentHash,
      )?.[0];
      if (twinId) {
        const list = itemsRef.current;
        const twin = list.find((item) => item.id === twinId);
        const keepThis =
          twin?.phase === 'ready' &&
          list.findIndex((item) => item.id === id) < list.findIndex((item) => item.id === twinId);

        if (!keepThis) {
          rejectItem(
            id,
            file.name,
            `Same contents as ${twin?.file.name || 'another file'}, which is already in the list.`,
          );
          return;
        }
        rejectItem(
          twinId,
          twin.file.name,
          `Same contents as ${file.name}, which is already in the list.`,
        );
      }

      if (check.contentHash) pendingHashes.current.set(id, check.contentHash);
      patchItem(id, { phase: 'ready', check });
    },
    [patchItem, rejectItem],
  );

  const addFiles = useCallback(
    async (incoming) => {
      const files = Array.from(incoming || []);
      if (!files.length) return;

      // The alert is about the latest drop, so it starts again with each one.
      setBatchError('');
      setRejections([]);

      // Names already waiting in the list, including ones added earlier in
      // this same drop. Finished rows don't hold a name: dropping a file
      // again after uploading it is a real question for the duplicate check.
      const takenNames = new Set(
        itemsRef.current.filter((item) => item.phase !== 'done').map((item) => item.file.name),
      );

      for (const file of files) {
        if (takenNames.has(file.name)) {
          setRejections((prev) => [
            ...prev,
            { name: file.name, reason: 'A file with this name is already in the list.' },
          ]);
          continue;
        }

        const validation = await validateFile(file);
        if (!validation.ok) {
          setRejections((prev) => [...prev, { name: file.name, reason: validation.reason }]);
          continue;
        }

        takenNames.add(file.name);
        const id = makeId();
        setItems((prev) => [...prev, { id, file, phase: 'checking', check: null, decision: null }]);
        checkItem(id, file);
      }
    },
    [checkItem],
  );

  const removeItem = useCallback(
    (id) => {
      clearStageTimers(id);
      pendingHashes.current.delete(id);
      setItems((prev) => prev.filter((item) => item.id !== id));
    },
    [clearStageTimers],
  );

  // Empties the list in one go. Files mid-upload stay: their requests are
  // already on the server and their rows report how they went. Nothing is
  // deleted from the bucket; uploaded files stay in Recent uploads.
  const clearAll = useCallback(() => {
    const keep = itemsRef.current.filter((item) => item.phase === 'uploading');
    const keepIds = new Set(keep.map((item) => item.id));

    itemsRef.current.forEach((item) => {
      if (keepIds.has(item.id)) return;
      clearStageTimers(item.id);
      pendingHashes.current.delete(item.id);
    });

    setItems((prev) => prev.filter((item) => keepIds.has(item.id)));
    setRejections([]);
    setBatchError('');
  }, [clearStageTimers]);

  const decideDuplicate = useCallback(
    (id, decision) => patchItem(id, { decision }),
    [patchItem],
  );

  // ---- Uploading ----------------------------------------------------------

  // One request per file, started together and never awaited as a group: a
  // file that fails, or one that takes a minute in Claude, leaves the others
  // to finish and report on their own.
  const uploadItem = useCallback(
    async (item) => {
      clearStageTimers(item.id);
      patchItem(item.id, { phase: 'uploading', stage: STAGES[0].key, outcome: null });

      const handles = STAGES.slice(1).map((stage) =>
        setTimeout(() => patchItem(item.id, { stage: stage.key }), stage.afterMs),
      );
      stageTimers.current.set(item.id, handles);

      try {
        const outcome = outcomeFromResult(await uploadFile(item.file, uploadOptionsFor(item)));

        if (outcome.kind === 'duplicate') {
          // The upload found an earlier copy the check did not (the check
          // failed, or another upload landed in between). Nothing was stored;
          // back to the list for the same decision as any other duplicate.
          patchItem(item.id, {
            phase: 'ready',
            stage: null,
            decision: null,
            check: {
              ...item.check,
              duplicate: {
                matchedOn: outcome.matchedOn,
                existingFilename: outcome.existingFilename,
                uploadedAt: outcome.uploadedAt,
              },
            },
          });
        } else {
          // Uploaded: no longer a pending copy that a new drop should be
          // compared against (the server's duplicate check takes over). A
          // failed file stays pending, since Try again can still send it.
          if (outcome.kind !== 'failed') pendingHashes.current.delete(item.id);
          patchItem(item.id, { phase: 'done', stage: null, outcome });
          loadHistory();
        }
      } catch (error) {
        patchItem(item.id, {
          phase: 'done',
          stage: null,
          outcome: { kind: 'failed', error: error.message },
        });
      } finally {
        clearStageTimers(item.id);
      }
    },
    [clearStageTimers, loadHistory, patchItem],
  );

  const startUpload = useCallback(() => {
    const uploadable = items.filter(isUploadable);
    if (!uploadable.length) return;

    if (uploadable.length > MAX_FILES_PER_BATCH) {
      setBatchError(
        `That is ${uploadable.length} files. Upload at most ${MAX_FILES_PER_BATCH} at a time.`,
      );
      return;
    }

    setBatchError('');
    uploadable.forEach((item) => uploadItem(item));
  }, [items, uploadItem]);

  const retryItem = useCallback(
    (id) => {
      const item = items.find((entry) => entry.id === id);
      if (item) uploadItem(item);
    },
    [items, uploadItem],
  );

  // ---- Loading ------------------------------------------------------------

  // A file that loaded is an ordinary uploaded file from here on; one that
  // did not stays ready to load, and the dialog said why.
  const handleLoaded = useCallback(
    (response) => {
      const byPath = new Map((response?.results || []).map((result) => [result.blob_path, result]));
      setItems((prev) =>
        prev.map((item) => {
          const result = item.outcome?.blobPath && byPath.get(item.outcome.blobPath);
          // A check with saving switched off leaves the file waiting to load.
          if (!wasSaved(result)) return item;
          return { ...item, outcome: { ...item.outcome, kind: 'mapped', processing: result.processing } };
        }),
      );
      loadHistory();
    },
    [loadHistory],
  );

  const loadingPaths = (loadingIds || [])
    .map((id) => items.find((item) => item.id === id)?.outcome?.blobPath)
    .filter(Boolean);

  // ---- Render -----------------------------------------------------------

  const uploadableCount = items.filter(isUploadable).length;
  const clearableCount = items.filter((item) => item.phase !== 'uploading').length;
  const blocker = uploadBlocker(items);
  const groups = groupFiles(items);

  return (
    <PageLayout title="Upload sales data">
      <div className="space-y-1">
        <section className="rounded-lg border border-lavander bg-white p-6 shadow-sm">
          {/* Files in flight don't hold the page: more can be added and
              uploaded while earlier ones are still being matched. */}
          <Dropzone onFiles={addFiles} />

          <RejectedFiles rejections={rejections} />

          {batchError && (
            <p className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {batchError}
            </p>
          )}

          {!!items.length && (
            <div className="mt-6 flex items-center justify-between gap-3 border-b border-lavander pb-2">
              <p className="text-sm font-medium text-deep-violet-blue">
                {items.length} file{items.length === 1 ? '' : 's'}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={clearAll}
                disabled={!clearableCount}
                title="Remove every file from this list. Nothing already uploaded is deleted."
                className="text-deep-violet-blue/70 hover:bg-lavander hover:text-deep-violet-blue"
              >
                <ListX aria-hidden="true" />
                Clear all
              </Button>
            </div>
          )}

          {groups.map((group) => (
            <UploadGroup
              key={group.key}
              group={group}
              onRemove={removeItem}
              onRetry={retryItem}
              onDecide={decideDuplicate}
              onLoad={setLoadingIds}
            />
          ))}

          <div className="mt-6 flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
            <p aria-live="polite" className="text-sm text-deep-violet-blue/70">
              {blocker}
            </p>
            <button
              type="button"
              onClick={startUpload}
              disabled={!uploadableCount || Boolean(blocker)}
              className="rounded-lg border border-deep-violet-blue bg-deep-violet-blue px-5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-violet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {uploadableCount
                ? `Upload ${filesLabel(uploadableCount)}`
                : 'Upload'}
            </button>
          </div>
        </section>

        <RecentUploads
          uploads={history}
          isLoading={isLoadingHistory}
          error={historyError}
          onRefresh={loadHistory}
          onRollback={requestRollback}
          onDelete={deletion.request}
          onLoaded={handleLoaded}
          months={UPLOAD_HISTORY_MONTHS}
        />
        <ConfirmDialog
          open={Boolean(rollback.target)}
          title="Rollback this upload?"
          description="Its transformed sell-out rows will be removed, and any older values it replaced will be restored. The raw file and mapping will be kept for audit."
          details={rollback.target ? [
            { label: 'File', value: rollback.target.filename },
            { label: 'Rows loaded', value: rollback.target.rows_stored ?? '—' },
            { label: 'Uploaded', value: formatDateTime(rollback.target.uploaded_at) },
          ] : []}
          confirmLabel="Rollback upload"
          pendingLabel="Rolling back…"
          isPending={rollback.isPending}
          confirmDisabled={rollbackReason.trim().length < 3}
          onConfirm={rollback.confirm}
          onCancel={rollback.cancel}
        >
          <label className="mt-3 block text-sm font-medium text-deep-violet-blue" htmlFor="rollback-reason">
            Reason for rollback <span className="text-red-700">*</span>
          </label>
          <textarea
            id="rollback-reason"
            value={rollbackReason}
            onChange={(event) => setRollbackReason(event.target.value)}
            maxLength={500}
            rows={3}
            required
            placeholder="For example: Uploaded under the wrong customer"
            className="mt-1.5 w-full resize-y rounded-md border border-lavander bg-white px-3 py-2 text-sm text-deep-violet-blue outline-none placeholder:text-deep-violet-blue/40 focus:border-deep-violet-blue"
          />
          <p className="mt-1 text-xs text-deep-violet-blue/60">
            This reason will be saved in the rollback audit trail.
          </p>
        </ConfirmDialog>
        <ConfirmDialog
          open={Boolean(deletion.target)}
          title="Delete this uploaded file?"
          description="The raw source file will be permanently removed from GCS. Its confirmed mapping and retained ingestion audit will not be deleted."
          details={deletion.target ? [
            { label: 'File', value: deletion.target.filename },
            { label: 'Customer', value: deletion.target.vendor || '—' },
            { label: 'Uploaded', value: formatDateTime(deletion.target.uploaded_at) },
          ] : []}
          confirmLabel="Delete file"
          pendingLabel="Deleting…"
          isPending={deletion.isPending}
          onConfirm={deletion.confirm}
          onCancel={deletion.cancel}
        />
        <Toast toast={toast} onDismiss={dismissToast} />
      </div>

      <LoadConfirmDialog
        open={loadingIds !== null}
        blobPaths={loadingPaths}
        onClose={() => setLoadingIds(null)}
        onLoaded={handleLoaded}
      />
    </PageLayout>
  );
}
