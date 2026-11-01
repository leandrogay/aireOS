'use client';

import { Clock3, MessageSquareText, UserRound } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatDateTime } from '@/lib/formatDate';

/**
 * @param {{ open: boolean, upload: object | null, onClose: () => void }} props
 */
export default function RollbackDetailsDialog({ open, upload, onClose }) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl text-deep-violet-blue">
            Rollback details
          </DialogTitle>
          <DialogDescription className="break-words text-xs text-deep-violet-blue/65">
            {upload?.filename || 'Upload audit trail'}
          </DialogDescription>
        </DialogHeader>

        <dl className="overflow-hidden rounded-lg border border-lavander bg-cream/30 text-sm text-deep-violet-blue">
          <div className="flex gap-3 border-b border-lavander px-3 py-3">
            <UserRound aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-deep-violet-blue/50" />
            <div className="min-w-0">
              <dt className="text-xs text-deep-violet-blue/60">Performed by</dt>
              <dd className="mt-0.5 break-words font-medium">
                {upload?.rolled_back_by || 'Unknown user'}
              </dd>
            </div>
          </div>
          <div className="flex gap-3 border-b border-lavander px-3 py-3">
            <Clock3 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-deep-violet-blue/50" />
            <div>
              <dt className="text-xs text-deep-violet-blue/60">Rolled back on</dt>
              <dd className="mt-0.5 font-medium tabular-nums">
                {upload?.rolled_back_at ? formatDateTime(upload.rolled_back_at) : 'Unknown time'}
              </dd>
            </div>
          </div>
          <div className="flex gap-3 px-3 py-3">
            <MessageSquareText aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-deep-violet-blue/50" />
            <div className="min-w-0">
              <dt className="text-xs text-deep-violet-blue/60">Reason</dt>
              <dd className="mt-0.5 whitespace-pre-wrap break-words font-medium">
                {upload?.rollback_reason || 'No reason recorded.'}
              </dd>
            </div>
          </div>
        </dl>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
