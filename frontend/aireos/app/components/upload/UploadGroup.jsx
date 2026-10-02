'use client';

import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  CopyCheck,
  FilePlus2,
  Loader2,
  XCircle,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import UploadFileRow from '@/components/upload/UploadFileRow';

// The icon and colour each section's heading carries, keyed like FILE_GROUPS
// in app/utils/uploadFlow.js. The heading is where a file's state is shown
// now, once per section instead of a badge on every row; the icon repeats
// the words' meaning in a shape, so it never rests on colour alone.
const GROUP_ICONS = {
  checking: { Icon: Loader2, className: 'animate-spin text-violet motion-reduce:animate-none' },
  ready: { Icon: CheckCircle2, className: 'text-green-700' },
  uploaded: { Icon: CheckCircle2, className: 'text-green-700' },
  duplicate: { Icon: CopyCheck, className: 'text-amber-700' },
  failed: { Icon: XCircle, className: 'text-red-700' },
  needs_review: { Icon: AlertTriangle, className: 'text-amber-700' },
  near_match: { Icon: AlertTriangle, className: 'text-amber-700' },
  new_layout: { Icon: FilePlus2, className: 'text-amber-700' },
  unchecked: { Icon: CircleDashed, className: 'text-deep-violet-blue/60' },
};

/**
 * One section of the upload list: a heading with the state and a count, the
 * one-line explanation for every file in it, then the files.
 *
 * @param {{
 *   group: { key: string, label: string, note?: string, items: object[] },
 *   onRemove: (id: string) => void,
 *   onRetry: (id: string) => void,
 *   onDecide: (id: string, decision: 'replace' | 'keep') => void,
 * }} props
 */
export default function UploadGroup({ group, onRemove, onRetry, onDecide }) {
  const { Icon, className } = GROUP_ICONS[group.key];
  const headingId = `upload-group-${group.key}`;

  return (
    <section aria-labelledby={headingId} className="mt-5">
      <h2
        id={headingId}
        className="flex items-center gap-1.5 text-sm font-medium text-deep-violet-blue"
      >
        <Icon aria-hidden="true" className={cn('size-4 shrink-0', className)} />
        {group.label}
        <span className="font-normal text-deep-violet-blue/50 tabular-nums">
          ({group.items.length})
        </span>
      </h2>
      {group.note && (
        <p className="mt-0.5 pl-5.5 text-xs text-deep-violet-blue/70">{group.note}</p>
      )}
      <ul className="mt-2 space-y-2">
        {group.items.map((item) => (
          <UploadFileRow
            key={item.id}
            item={item}
            onRemove={onRemove}
            onRetry={onRetry}
            onDecide={onDecide}
          />
        ))}
      </ul>
    </section>
  );
}
