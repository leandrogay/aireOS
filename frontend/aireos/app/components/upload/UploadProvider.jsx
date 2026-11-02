'use client';

import { createContext, useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { MAX_FILES_PER_BATCH } from '@/app/config/upload';
import { validateFile } from '@/app/utils/fileInspect';
import { wasSaved } from '@/app/utils/loadPreview';
import {
  STAGES,
  checkFromResult,
  isUploadable,
  outcomeFromResult,
  uploadOptionsFor,
} from '@/app/utils/uploadFlow';
import { checkUpload, uploadFile } from '@/app/services/uploadApi';
import UploadTray from '@/components/upload/UploadTray';

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

  // Called when a proposal is discarded (the server deletes the files that were
  // waiting on it, DELETE /api/mappings/{fp}/pending) or approved (the review is
  // done and the files move on to Recent uploads, which tracks their load). Either
  // way their rows would otherwise keep offering a review that no longer exists.
  const forgetMapping = useCallback((fingerprint) => {
    const waiting = (item) =>
      item.phase === 'done' &&
      item.outcome.kind === 'needs_review' &&
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
  // file that fails, or one that takes a minute in Claude, leaves the others
  // to finish and report on their own.
  //
  // Two parts: sending the bytes has a real percentage (sendPercent), then the
  // server's work has none, so its labels start on their timers once the file
  // has been sent (see STAGES). A large file would otherwise read "Processing
  // file" while most of it was still on its way.
  const uploadItem = useCallback(
    async (item) => {
      clearStageTimers(item.id);
      patchItem(item.id, {
        phase: 'uploading',
        stage: STAGES[0].key,
        sendPercent: 0,
        outcome: null,
        sentBack: false,
        uploadRun: (item.uploadRun || 0) + 1,
      });

      const startStageTimers = () => {
        patchItem(item.id, { sendPercent: null });
        const handles = STAGES.slice(1).map((stage) =>
          setTimeout(() => patchItem(item.id, { stage: stage.key }), stage.afterMs),
        );
        stageTimers.current.set(item.id, handles);
      };

      try {
        const outcome = outcomeFromResult(
          await uploadFile(item.file, {
            ...uploadOptionsFor(item),
            onProgress: (percent) => patchItem(item.id, { sendPercent: percent }),
            onSent: startStageTimers,
          }),
        );

        if (outcome.kind === 'duplicate') {
          // The upload found an earlier copy the check did not (the check
          // failed, or another upload landed in between). Nothing was stored;
          // back to the list for the same decision as any other duplicate.
          // sentBack keeps it in the tray, which would otherwise lose a file
          // that still needs an answer from someone on another page.
          patchItem(item.id, {
            phase: 'ready',
            stage: null,
            sendPercent: null,
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
          patchItem(item.id, { phase: 'done', stage: null, sendPercent: null, outcome });
          setUploadsFinished((count) => count + 1);
        }
      } catch (error) {
        patchItem(item.id, {
          phase: 'done',
          stage: null,
          sendPercent: null,
          outcome: { kind: 'failed', error: error.message },
        });
      } finally {
        clearStageTimers(item.id);
      }
    },
    [clearStageTimers, patchItem],
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
    clearAll,
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
