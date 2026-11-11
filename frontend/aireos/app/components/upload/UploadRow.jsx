'use client';

import Link from 'next/link';
import { Database, History, RefreshCw, Trash2, Undo2 } from 'lucide-react';

import RowActions from '@/components/ui/RowActions';
import StatusBadge from '@/components/ui/StatusBadge';
import TableRow from '@/components/ui/TableRow';
import { formatDateTime } from '@/lib/formatDate';
import { cn } from '@/lib/utils';
import { vendorLabel } from '@/app/utils/retailerLabel';
import { deleteBlockedReason, loadActionFor, uploadStatus } from '@/app/utils/uploadHistory';

import { UPLOAD_HIDE } from './columns';

/**
 * The "…" menu items for one upload, shared by its table row and its phone
 * card: Load / Reload when its mapping is approved but its data isn't loaded
 * (or was loaded with an older version), rollback details or Rollback, then
 * Delete, greyed out with the reason while the file still has data loaded.
 *
 * @param {object} upload GET /api/uploads/history row
 * @param {{
 *   onLoad: (load: { blobPath: string, reload: boolean }) => void,
 *   onRollbackDetails: (upload: object) => void,
 *   onRollback: (upload: object) => void,
 *   onDelete: (upload: object) => void,
 * }} handlers
 * @returns {object[]} RowActions `actions`
 */
export function uploadRowActions(upload, { onLoad, onRollbackDetails, onRollback, onDelete }) {
  const actions = [];
  const load = loadActionFor(upload);

  if (load) {
    actions.push({
      key: load.reload ? 'reload' : 'load',
      label: load.label,
      icon: load.reload ? RefreshCw : Database,
      onSelect: () => onLoad({ blobPath: upload.blob_path, reload: load.reload }),
    });
  }
  if (upload.status === 'rolled_back') {
    actions.push({
      key: 'rollback-details',
      label: 'View rollback details',
      icon: History,
      onSelect: () => onRollbackDetails(upload),
    });
  }
  if (upload.rollback_available) {
    actions.push({
      key: 'rollback',
      label: 'Rollback upload',
      icon: Undo2,
      onSelect: () => onRollback(upload),
    });
  }
  actions.push({
    key: 'delete',
    label: 'Delete upload',
    icon: Trash2,
    onSelect: () => onDelete(upload),
    disabledReason: deleteBlockedReason(upload),
    destructive: true,
  });
  return actions;
}

/**
 * The upload's status badge.
 *
 * @param {{ upload: object }} props
 */
export function UploadStatusBadge({ upload }) {
  const status = uploadStatus(upload);
  return <StatusBadge tone={status.tone}>{status.label}</StatusBadge>;
}

/**
 * A link to the upload's nomenclature, or a dash when it has none (or it
 * was discarded).
 *
 * @param {{ upload: object }} props
 */
export function NomenclatureLink({ upload }) {
  if (!upload.mapping_fingerprint || !upload.mapping_available) {
    return <span className="text-deep-violet-blue/60">—</span>;
  }
  return (
    <Link
      href={`/mappings/${upload.mapping_fingerprint}`}
      title={upload.mapping_name || undefined}
      className="block truncate font-medium underline underline-offset-2 hover:opacity-80"
    >
      {/* Once a mapping is approved under a name, that name is what
          identifies it here. */}
      {upload.mapping_name || 'View nomenclature'}
    </Link>
  );
}

/**
 * One row of Recent uploads, in UPLOAD_COLUMNS order.
 *
 * @param {{ upload: object, actions: object[] }} props actions from uploadRowActions
 */
export default function UploadRow({ upload, actions }) {
  return (
    <TableRow className="h-12 border-b border-lavander/80">
      <td className="px-4 py-2.5 font-medium" title={upload.filename}>
        <span className="block truncate">{upload.filename}</span>
      </td>
      <td className="truncate px-4 py-2.5">{vendorLabel(upload.vendor) || '—'}</td>
      <td className="px-4 py-2.5">{formatDateTime(upload.uploaded_at)}</td>
      <td className="px-4 py-2.5">
        <UploadStatusBadge upload={upload} />
      </td>
      <td className={cn('px-4 py-2.5', UPLOAD_HIDE.nomenclature)}>
        <NomenclatureLink upload={upload} />
      </td>
      <td className="px-2 py-1.5 text-right">
        <RowActions label={`Actions for upload ${upload.filename}`} actions={actions} />
      </td>
    </TableRow>
  );
}
