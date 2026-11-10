'use client';

import { createContext, useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { MAX_FILES_PER_BATCH } from '@/app/config/upload';
import { validateFile } from '@/app/utils/fileInspect';
import { wasSaved } from '@/app/utils/loadPreview';
import {
  checkFromResult,
  isSkipped,
  isUploadable,
  outcomeFromResult,
  uploadOptionsFor,
} from '@/app/utils/uploadFlow';
import { modelToastText } from '@/app/utils/aiModels';
import { FINISH_PAUSE_MS } from '@/app/utils/uploadProgress';
import { getAiModelStatus } from '@/app/services/aiModelsApi';
import { checkUpload, uploadFile } from '@/app/services/uploadApi';
import Toast from '@/components/ui/Toast';
import UploadTray from '@/components/upload/UploadTray';
import useToast from '@/hooks/useToast';

let nextId = 0;
const makeId = () => `file-${(nextId += 1)}`;
let nextBatchId = 0;
const makeBatchId = () => `batch-${(nextBatchId += 1)}`;

// Tells the person an upload's mapping model is retired. The status read only
// decides whether the Assistant's model is retired too; if it fails, the
// mapping-only wording is still true.
async function warnModelUnavailable(notify) {
  let status = null;
  try {
    status = await getAiModelStatus();
  } catch {
    // Keep the mapping-only message.
  }
  notify('warning', modelToastText(status));
}

// A file in the list moves through phases:
//   checking   dropped; POST /api/uploads/check is answering what would happen
//   ready      checked (or the check failed); waits for Upload
//   uploading  POST /api/uploads in flight
//   done       the upload answered; `outcome` says how it went. With
//              REQUIRE_LOAD_CONFIRMATION on, a known layout is done but
//              `ready_to_load` until someone confirms a load from its row.
// Pressing Upload stamps the files it sends with one `batch` ({ id,
// startedAt }), so the page can show each press's results together and keep
// them apart from files added after it (uploadFlow.uploadBatches).
// Files that cannot be uploaded never become rows; they are listed in the
// RejectedFiles alert instead.

/** The upload list and its actions; read it with hooks/useUploads. */
export const UploadContext = createContext(null);

// The list lives here, in the root layout, rather than in the upload page, so
// it outlives the page: people can go elsewhere while files upload, and come
// back to the same rows. The upload page and UploadTray are two views of it.
function UploadQueue({ showTray, children }) {
  const [items, setItems] = useState([]);
  const [rejections, setRejections] = useState([]);
  const [batchError, setBatchError] = useState('');
  // Counts uploads that answered; the upload page reloads Recent uploads on it.
  const [uploadsFinished, setUploadsFinished] = useState(0);
  // Warns when an upload found its AI model retired. Here rather than on the
  // upload page so it shows wherever the person is when the upload answers.
  const { toast, notify, dismissToast } = useToast();
  const notifyRef = useRef(notify);
  useEffect(() => {
    notifyRef.current = notify;
  }, [notify]);

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

  // Moving between pages keeps an upload going, but a refresh or a closed tab
  // ends it, so the browser asks first while one is still in flight.
  const isUploading = items.some((item) => item.phase === 'uploading');
  useEffect(() => {
    if (!isUploading) return undefined;
    function warnBeforeLeaving(event) {
      event.preventDefault();
    }
    window.addEventListener('beforeunload', warnBeforeLeaving);
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving);
  }, [isUploading]);

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
      pendingHashes.current.delete(id);
      setItems((prev) => prev.filter((item) => item.id !== id));
    },
    [],
  );

  // Takes out every file that has not been sent: the "Remove all" of the
  // files waiting under the drop zone. Sent files keep their results.
  const clearStaged = useCallback(() => {
    const staged = itemsRef.current.filter((item) => !item.batch);
    staged.forEach((item) => pendingHashes.current.delete(item.id));
    const stagedIds = new Set(staged.map((item) => item.id));
    setItems((prev) => prev.filter((item) => !stagedIds.has(item.id)));
    setRejections([]);
    setBatchError('');
  }, []);

  // Takes the finished results out of the list. Files mid-upload stay: their
  // requests are already on the server and their rows report how they went.
  // Nothing is deleted from the bucket; uploaded files stay in Recent uploads.
  // A failed file was never stored, so clearing it also forgets its hash, or
  // dropping it in again would be turned away as a copy of a row that is gone.
  const clearFinished = useCallback(() => {
    const finished = (item) => item.batch && item.phase === 'done';
    itemsRef.current.filter(finished).forEach((item) => pendingHashes.current.delete(item.id));
    setItems((prev) => prev.filter((item) => !finished(item)));
  }, []);

  // Called when a proposal is discarded (the server deletes the files that were
  // waiting on it, DELETE /api/mappings/{fp}/pending) or approved (the review is
  // done and the files move on to Recent uploads, which tracks their load). Either
  // way their rows would otherwise keep offering a review that no longer exists.
  // A near match ('partial') points at the closest saved mapping, not a proposal
  // of its own: approving that mapping does not re-stamp this file (backend
  // mark_uploads_after_approval goes by the file's own fingerprint), so its row
  // stays and still needs a nomenclature.
  const forgetMapping = useCallback((fingerprint) => {
    const waiting = (item) =>
      item.phase === 'done' &&
      item.outcome.kind === 'needs_review' &&
      item.outcome.why !== 'partial' &&
      item.outcome.mappingId === fingerprint;

    itemsRef.current.filter(waiting).forEach((item) => pendingHashes.current.delete(item.id));
    setItems((prev) => prev.filter((item) => !waiting(item)));
  }, []);

  const decideDuplicate = useCallback(
    (id, decision) => patchItem(id, { decision }),
    [patchItem],
  );

  // ---- Uploading ----------------------------------------------------------

  // One request per file, started together and never awaited as a group: a
  // file that fails, or one that takes a minute in Gemini, leaves the others
  // to finish and report on their own.
  //
  // Two parts on one bar (UploadProgress): sending the bytes has a real
  // percentage (sendPercent), then the server's work has none, so the bar
  // estimates it from the time since the file was sent (sentAt). A large file
  // would otherwise read "Processing file" while most of it was still on its
  // way. When the response lands the bar fills (finished) and holds for
  // FINISH_PAUSE_MS, so the result replaces a full bar rather than a partial
  // one, which would read as cut short.
  const uploadItem = useCallback(
    async (item, batch) => {
      patchItem(item.id, {
        batch,
        phase: 'uploading',
        sendPercent: 0,
        sentAt: null,
        finished: false,
        outcome: null,
        sentBack: false,
        uploadRun: (item.uploadRun || 0) + 1,
      });
      const progressCleared = { sendPercent: null, sentAt: null, finished: false };

      try {
        const outcome = outcomeFromResult(
          await uploadFile(item.file, {
            ...uploadOptionsFor(item),
            onProgress: (percent) => patchItem(item.id, { sendPercent: percent }),
            onSent: () => patchItem(item.id, { sendPercent: null, sentAt: Date.now() }),
          }),
        );

        patchItem(item.id, { finished: true });
        await new Promise((resolve) => setTimeout(resolve, FINISH_PAUSE_MS));

        if (outcome.kind === 'duplicate') {
          // The upload found an earlier copy the check did not (the check
          // failed, or another upload landed in between). Nothing was stored;
          // back to the list for the same decision as any other duplicate.
          // sentBack keeps it in the tray, which would otherwise lose a file
          // that still needs an answer from someone on another page.
          // Out of its batch and back under the drop zone, where the
          // decision is made.
          patchItem(item.id, {
            ...progressCleared,
            batch: null,
            phase: 'ready',
            decision: null,
            sentBack: true,
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
          patchItem(item.id, { ...progressCleared, phase: 'done', outcome });
          setUploadsFinished((count) => count + 1);
          if (outcome.aiUnavailable) warnModelUnavailable(notifyRef.current);
        }
      } catch (error) {
        patchItem(item.id, {
          ...progressCleared,
          phase: 'done',
          outcome: { kind: 'failed', error: error.message },
        });
      }
    },
    [patchItem],
  );

  const startUpload = useCallback(() => {
    const uploadable = items.filter(isUploadable);
    const skipped = items.filter(isSkipped);
    if (!uploadable.length && !skipped.length) return;

    if (uploadable.length > MAX_FILES_PER_BATCH) {
      setBatchError(
        `That is ${uploadable.length} files. Upload at most ${MAX_FILES_PER_BATCH} at a time.`,
      );
      return;
    }

    setBatchError('');
    const batch = { id: makeBatchId(), startedAt: new Date().toISOString() };
    // Skipped duplicates are settled by this press too: reported in its batch,
    // never sent.
    skipped.forEach((item) => {
      pendingHashes.current.delete(item.id);
      patchItem(item.id, { batch, phase: 'done', outcome: { kind: 'skipped' } });
    });
    uploadable.forEach((item) => uploadItem(item, batch));
  }, [items, patchItem, uploadItem]);

  const retryItem = useCallback(
    (id) => {
      const item = items.find((entry) => entry.id === id);
      // Tried again where it failed: in the batch it was sent with.
      if (item) uploadItem(item, item.batch);
    },
    [items, uploadItem],
  );

  // ---- Loading ------------------------------------------------------------

  // A file that loaded is finished, so its row leaves the list and Recent
  // uploads is where it is found; one that did not stays ready to load, and the
  // dialog said why.
  const markLoaded = useCallback((response) => {
    const byPath = new Map((response?.results || []).map((result) => [result.blob_path, result]));
    const isLoaded = (item) => {
      const result = item.outcome?.blobPath && byPath.get(item.outcome.blobPath);
      // A check with saving switched off leaves the file waiting to load.
      return wasSaved(result);
    };
    setItems((prev) => prev.filter((item) => !isLoaded(item)));
  }, []);

  const value = {
    items,
    rejections,
    batchError,
    uploadsFinished,
    addFiles,
    removeItem,
    clearStaged,
    clearFinished,
    forgetMapping,
    decideDuplicate,
    startUpload,
    retryItem,
    markLoaded,
  };

  return (
    <UploadContext.Provider value={value}>
      {children}
      {showTray && <UploadTray items={items} onRetry={retryItem} />}
      <Toast toast={toast} onDismiss={dismissToast} />
    </UploadContext.Provider>
  );
}

/**
 * Keeps one upload list for the whole signed-in session. Reaching the login
 * page starts a new list (the key remounts it), so one person's uploads are
 * never left on screen for whoever signs in next.
 */
export default function UploadProvider({ children }) {
  const signedOut = usePathname() === '/login';
  return (
    <UploadQueue key={signedOut ? 'signed-out' : 'signed-in'} showTray={!signedOut}>
      {children}
    </UploadQueue>
  );
}
