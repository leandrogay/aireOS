'use client';

import { CircleAlert } from 'lucide-react';

/**
 * Files from the last drop that cannot be uploaded, each with its reason.
 * They never join the list: there is nothing to do with them there, so a row
 * with a badge and a remove button would only be in the way. The page clears
 * this when the next files are dropped.
 *
 * @param {{ rejections: Array<{ name: string, reason: string }> }} props
 */
export default function RejectedFiles({ rejections }) {
  if (!rejections.length) return null;

  const count = rejections.length;

  return (
    <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3">
      <p className="flex items-center gap-2 text-sm font-medium text-red-800">
        <CircleAlert aria-hidden="true" className="size-4 shrink-0" />
        {count === 1 ? "1 file can't be uploaded" : `${count} files can't be uploaded`}
      </p>
      <ul className="mt-1.5 space-y-1 pl-6 text-xs text-red-700">
        {rejections.map(({ name, reason }, index) => (
          <li key={`${name}-${index}`} className="break-words">
            <span className="font-medium">{name}</span>: {reason}
          </li>
        ))}
      </ul>
    </div>
  );
}
