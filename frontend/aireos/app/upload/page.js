'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import PageLayout from '@/components/layout/PageLayout';
import Dropzone from '../components/upload/Dropzone';
import UploadFileRow from '../components/upload/UploadFileRow';
import RecentUploads from '../components/upload/RecentUploads';
import { MAX_FILES_PER_BATCH } from '../config/upload';
import { validateFile } from '../utils/fileInspect';
import { STAGES, outcomeFromResult, summariseOutcomes } from '../utils/uploadFlow';
import { uploadFile, fetchUploadHistory } from '../services/uploadApi';

let nextId = 0;
const makeId = () => `file-${(nextId += 1)}`;

export default function UploadPage() {
  const [items, setItems] = useState([]);
  const [batchError, setBatchError] = useState('');
  const [history, setHistory] = useState([]);
  const [historyError, setHistoryError] = useState('');
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  // Stage timers keyed by item id, so a file that finishes early stops
  // advancing its own labels without touching any other file's.
  const stageTimers = useRef(new Map());

  // Validation reads the file, so by the time a row is built the state it was
  // checked against has moved on. This is what the duplicate-name check reads.
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

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
      setHistory(await fetchUploadHistory());
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

  // ---- Selection --------------------------------------------------------

  const addFiles = useCallback(async (incoming) => {
    const files = Array.from(incoming || []);
    if (!files.length) return;

    setBatchError('');

    // Names already spoken for, including ones added earlier in this same drop
    // — a rejected row doesn't hold its name, since it is not going anywhere.
    const takenNames = new Set(
      itemsRef.current
        .filter((item) => item.status !== 'rejected')
        .map((item) => item.file.name),
    );

    const rows = [];
    for (const file of files) {
      if (takenNames.has(file.name)) {
        rows.push({
          id: makeId(),
          file,
          status: 'rejected',
          rejection: 'Another file in this batch has the same name',
        });
        continue;
      }

      const check = await validateFile(file);
      rows.push({
        id: makeId(),
        file,
        status: check.ok ? 'ready' : 'rejected',
        rejection: check.ok ? null : check.reason,
      });

      if (check.ok) takenNames.add(file.name);
    }

    setItems((prev) => [...prev, ...rows]);
  }, []);

  const removeItem = useCallback(
    (id) => {
      clearStageTimers(id);
      setItems((prev) => prev.filter((item) => item.id !== id));
    },
    [clearStageTimers],
  );

  const removeAll = useCallback(() => {
    stageTimers.current.forEach((handles) => handles.forEach(clearTimeout));
    stageTimers.current.clear();
    setItems([]);
    setBatchError('');
  }, []);

  // ---- Processing -------------------------------------------------------

  // One request per file, started together and never awaited as a group: a
  // file that fails, or one that takes a minute in Claude, leaves the others
  // to finish and report on their own.
  const processItem = useCallback(
    async (item, options = {}) => {
      clearStageTimers(item.id);
      patchItem(item.id, {
        status: 'processing',
        stage: STAGES[0].key,
        outcome: null,
        busy: true,
      });

      const handles = STAGES.slice(1).map((stage) =>
        setTimeout(() => patchItem(item.id, { stage: stage.key }), stage.afterMs),
      );
      stageTimers.current.set(item.id, handles);

      try {
        const result = await uploadFile(item.file, options);
        patchItem(item.id, {
          status: 'done',
          stage: null,
          busy: false,
          outcome: outcomeFromResult(result),
        });
        loadHistory();
      } catch (error) {
        patchItem(item.id, {
          status: 'done',
          stage: null,
          busy: false,
          outcome: { kind: 'failed', error: error.message },
        });
      } finally {
        clearStageTimers(item.id);
      }
    },
    [clearStageTimers, loadHistory, patchItem],
  );

  const startUpload = useCallback(() => {
    const ready = items.filter((item) => item.status === 'ready');
    if (!ready.length) return;

    if (ready.length > MAX_FILES_PER_BATCH) {
      setBatchError(
        `That is ${ready.length} files. Upload at most ${MAX_FILES_PER_BATCH} at a time.`,
      );
      return;
    }

    setBatchError('');
    ready.forEach((item) => processItem(item));
  }, [items, processItem]);

  const retryItem = useCallback(
    (id) => {
      const item = items.find((entry) => entry.id === id);
      if (item) processItem(item);
    },
    [items, processItem],
  );

  const resolveDuplicate = useCallback(
    (id, choice) => {
      const item = items.find((entry) => entry.id === id);
      if (!item) return;

      if (choice === 'skip') {
        patchItem(id, { outcome: { kind: 'skipped' }, busy: false });
        return;
      }

      processItem(item, choice === 'replace' ? { force: true } : { keepDuplicate: true });
    },
    [items, patchItem, processItem],
  );

  // ---- Render -----------------------------------------------------------

  const readyCount = items.filter((item) => item.status === 'ready').length;
  const isProcessing = items.some((item) => item.status === 'processing');
  const summary = summariseOutcomes(items);

  return (
    <PageLayout title="Upload sales data">
      <p className="mb-5 -mt-1 text-sm text-deep-violet-blue/80">
        Drop retailer sales exports here. Each file is checked, matched to a mapping, and
        queued for review if the layout is new.
      </p>

      <div className="space-y-6">
        <section className="rounded-xl border border-lavander bg-white p-6 shadow-sm">
          {/* Files in flight don't hold the page: more can be added and
              uploaded while earlier ones are still being matched. */}
          <Dropzone onFiles={addFiles} />

          {batchError && (
            <p className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {batchError}
            </p>
          )}

          {!!items.length && (
            <>
              <div className="mt-6 mb-3 flex flex-wrap items-center justify-between gap-3">
                <p
                  aria-live="polite"
                  className="text-sm font-medium text-deep-violet-blue"
                >
                  {summary || `${items.length} file${items.length === 1 ? '' : 's'}`}
                </p>
                <button
                  type="button"
                  onClick={removeAll}
                  disabled={isProcessing}
                  className="rounded-md border border-violet bg-white px-3 py-1.5 text-xs font-medium text-deep-violet-blue transition hover:bg-lavander disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Remove all
                </button>
              </div>

              <ul className="space-y-3">
                {items.map((item) => (
                  <UploadFileRow
                    key={item.id}
                    item={item}
                    onRemove={removeItem}
                    onRetry={retryItem}
                    onResolveDuplicate={resolveDuplicate}
                  />
                ))}
              </ul>
            </>
          )}

          <div className="mt-6 flex justify-end">
            <button
              type="button"
              onClick={startUpload}
              disabled={!readyCount}
              className="rounded-lg border border-deep-violet-blue bg-deep-violet-blue px-5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-violet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {readyCount
                ? `Upload ${readyCount} file${readyCount === 1 ? '' : 's'}`
                : 'Upload'}
            </button>
          </div>
        </section>

        <RecentUploads
          uploads={history}
          isLoading={isLoadingHistory}
          error={historyError}
          onRefresh={loadHistory}
        />
      </div>
    </PageLayout>
  );
}
