'use client';

import { useCallback, useEffect, useState } from 'react';
import { Eraser, ListX } from 'lucide-react';
import PageLayout from '@/components/layout/PageLayout';
import { formatDateTime } from '@/lib/formatDate';
import { Button } from '@/components/ui/button';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Toast from '@/components/ui/Toast';
import Dropzone from '../components/upload/Dropzone';
import RejectedFiles from '../components/upload/RejectedFiles';
import UploadBatch from '../components/upload/UploadBatch';
import UploadGroup from '../components/upload/UploadGroup';
import RecentUploads from '../components/upload/RecentUploads';
import LoadConfirmDialog from '../components/upload/LoadConfirmDialog';
import {
  UPLOAD_HISTORY_LIMIT,
  UPLOAD_HISTORY_MONTHS,
} from '../config/upload';
import {
  filesLabel,
  groupFiles,
  isSkipped,
  isStaged,
  isUploadable,
  uploadBatches,
  uploadBlocker,
} from '../utils/uploadFlow';
import {
  deleteUpload,
  fetchUploadHistory,
  rollbackUpload,
} from '../services/uploadApi';
import useConfirmAction from '@/hooks/useConfirmAction';
import useToast from '@/hooks/useToast';
import useUploads from '@/hooks/useUploads';

// The file list itself lives in UploadProvider, so uploads carry on while
// people use other pages; this page shows it, plus Recent uploads.
export default function UploadPage() {
  const {
    items,
    rejections,
    batchError,
    uploadsFinished,
    addFiles,
    removeItem,
    clearStaged,
    clearFinished,
    decideDuplicate,
    startUpload,
    retryItem,
    markLoaded,
  } = useUploads();
  const [history, setHistory] = useState([]);
  const [historyError, setHistoryError] = useState('');
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [rollbackReason, setRollbackReason] = useState('');
  const { toast, notify, dismissToast } = useToast();
  // The rows whose files the load confirmation is open for, or null.
  const [loadingIds, setLoadingIds] = useState(null);

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
    // uploadsFinished: an upload that answered belongs in Recent uploads.
  }, [loadHistory, uploadsFinished]);

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

  // ---- Loading ------------------------------------------------------------

  const handleLoaded = useCallback(
    (response) => {
      markLoaded(response);
      loadHistory();
    },
    [loadHistory, markLoaded],
  );

  const loadingPaths = (loadingIds || [])
    .map((id) => items.find((item) => item.id === id)?.outcome?.blobPath)
    .filter(Boolean);

  // ---- Render -----------------------------------------------------------

  // Two places, as file managers and cloud drives keep them: files added and
  // not sent yet, under the drop zone with the Upload button that sends them;
  // and what each Upload press came to, newest first, in its own card. A new
  // drop never mixes with the results of the last one.
  const staged = items.filter(isStaged);
  const stagedGroups = groupFiles(staged, { newestFirst: true });
  const batches = uploadBatches(items);
  const uploadableCount = staged.filter(isUploadable).length;
  const skippedCount = staged.filter(isSkipped).length;
  const blocker = uploadBlocker(staged);
  const finishedCount = items.filter((item) => item.batch && item.phase === 'done').length;

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

          {!!staged.length && (
            <div className="mt-6 flex items-center justify-between gap-3 border-b border-lavander pb-2">
              <p className="text-sm font-medium text-deep-violet-blue">
                {staged.length} new file{staged.length === 1 ? '' : 's'}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={clearStaged}
                title="Take every file that hasn't been sent out of this list."
                className="text-deep-violet-blue/70 hover:bg-lavander hover:text-deep-violet-blue"
              >
                <ListX aria-hidden="true" />
                Remove all
              </Button>
            </div>
          )}

          {stagedGroups.map((group) => (
            <UploadGroup
              key={group.key}
              group={group}
              idPrefix="staged"
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
              disabled={!(uploadableCount || skippedCount) || Boolean(blocker)}
              className="rounded-lg border border-deep-violet-blue bg-deep-violet-blue px-5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-violet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {/* Only skips left: pressing it files them under the batch. */}
              {uploadableCount
                ? `Upload ${filesLabel(uploadableCount)}`
                : skippedCount
                  ? `Skip ${filesLabel(skippedCount)}`
                  : 'Upload'}
            </button>
          </div>
        </section>

        {!!batches.length && (
          <section
            aria-labelledby="upload-results-heading"
            className="rounded-lg border border-lavander bg-white p-6 shadow-sm"
          >
            <div className="mb-4 flex items-center justify-between gap-3 border-b border-lavander pb-2">
              <h2 id="upload-results-heading" className="font-serif text-lg text-deep-violet-blue">
                Uploaded this session
              </h2>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={clearFinished}
                disabled={!finishedCount}
                title="Take finished uploads out of this list. Uploaded files stay in Recent uploads; failed ones can be dropped in again."
                className="text-deep-violet-blue/70 hover:bg-lavander hover:text-deep-violet-blue"
              >
                <Eraser aria-hidden="true" />
                Clear finished
              </Button>
            </div>
            <div className="space-y-4">
              {batches.map((batch, index) => (
                <UploadBatch
                  key={batch.id}
                  batch={batch}
                  isLatest={index === 0}
                  onRemove={removeItem}
                  onRetry={retryItem}
                  onDecide={decideDuplicate}
                  onLoad={setLoadingIds}
                />
              ))}
            </div>
          </section>
        )}

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
          description="Its transformed sell-out rows will be removed, and any older values it replaced will be restored. The raw file and nomenclature will be kept for audit."
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
          description="The raw source file will be permanently removed from GCS. Its confirmed nomenclature and retained ingestion audit will not be deleted."
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
