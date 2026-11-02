'use client';

import { useState } from 'react';
import Link from 'next/link';
import { RotateCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import UploadProgress from '@/components/upload/UploadProgress';
import { cn } from '@/lib/utils';
import { fileKind } from '@/app/utils/uploadFlow';
import { trayItems, trayRowKey, trayStatus, trayTitle } from '@/app/utils/uploadTray';

const LINK_CLASS =
  'mt-1 inline-block rounded-md text-xs font-medium text-deep-violet-blue underline underline-offset-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50';

// The next step for a finished file, where there is one. Decisions and the
// load confirmation live on the upload page, so the tray only points to them.
// Following a link means the tray has done its job, so it closes (onFollow).
function NextStep({ item, onRetry, onFollow }) {
  const kind = fileKind(item);
  if (kind === 'failed') {
    return (
      <button
        type="button"
        onClick={() => onRetry(item.id)}
        className="mt-1 inline-flex items-center gap-1 rounded-md text-xs font-medium text-deep-violet-blue underline underline-offset-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <RotateCw aria-hidden="true" className="size-3" />
        Try again
      </button>
    );
  }
  if (kind === 'ready_to_load') {
    return <Link href="/upload" onClick={onFollow} className={LINK_CLASS}>Review and load</Link>;
  }
  if (kind === 'duplicate') {
    return <Link href="/upload" onClick={onFollow} className={LINK_CLASS}>Go to uploads</Link>;
  }
  if (kind === 'needs_review' && item.outcome.mappingId) {
    return (
      <Link href={`/mappings/${item.outcome.mappingId}`} onClick={onFollow} className={LINK_CLASS}>
        {item.outcome.why === 'partial' ? 'View closest mapping' : 'Review mapping'}
      </Link>
    );
  }
  return null;
}

function TrayRow({ item, onRetry, onFollow }) {
  return (
    <li className="px-3 py-2">
      <p className="truncate text-xs font-medium text-deep-violet-blue" title={item.file.name}>
        {item.file.name}
      </p>
      {item.phase === 'uploading' ? (
        <UploadProgress stage={item.stage} sendPercent={item.sendPercent} />
      ) : (
        <>
          <p
            className={cn(
              'mt-0.5 text-xs',
              fileKind(item) === 'failed' ? 'text-red-700' : 'text-deep-violet-blue/70',
            )}
          >
            {trayStatus(item)}
          </p>
          <NextStep item={item} onRetry={onRetry} onFollow={onFollow} />
        </>
      )}
    </li>
  );
}

/**
 * Uploads in progress and just finished, on every page, in the bottom-left
 * corner of the window, over the nav bar whether it is open or collapsed, so
 * it never sits under the assistant in the bottom-right corner. It can be
 * closed once nothing is in flight, and closes itself when a file's next-step
 * link is followed. A file still in flight stays until it finishes. Closing
 * only clears the tray; the upload page's list keeps the files.
 *
 * @param {{ items: object[], onRetry: (id: string) => void }} props
 */
export default function UploadTray({ items, onRetry }) {
  const [closedKeys, setClosedKeys] = useState(() => new Set());
  const rows = trayItems(items, closedKeys);

  if (!rows.length) return null;

  const inFlight = rows.some((item) => item.phase === 'uploading');

  function closeFinished() {
    const finished = rows.filter((item) => item.phase !== 'uploading').map(trayRowKey);
    setClosedKeys((closed) => new Set([...closed, ...finished]));
  }

  return (
    <section
      aria-label="File uploads"
      className="fixed bottom-4 left-4 z-40 w-80 max-w-[calc(100vw-6rem)] overflow-hidden rounded-lg border border-lavander bg-white shadow-xl"
    >
      <div className="flex min-h-8 items-center justify-between gap-2 bg-violet py-1 pr-1 pl-3">
        <p aria-live="polite" className="truncate text-xs font-medium text-deep-violet-blue tabular-nums">
          {trayTitle(rows)}
        </p>
        {!inFlight && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={closeFinished}
            aria-label="Close uploads"
            className="shrink-0 text-deep-violet-blue hover:bg-white/40 hover:text-deep-violet-blue"
          >
            <X aria-hidden="true" />
          </Button>
        )}
      </div>
      <ul className="max-h-64 divide-y divide-lavander overflow-y-auto">
        {rows.map((item) => (
          <TrayRow key={item.id} item={item} onRetry={onRetry} onFollow={closeFinished} />
        ))}
      </ul>
    </section>
  );
}
