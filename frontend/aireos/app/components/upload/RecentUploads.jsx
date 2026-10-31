'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Database, History, RefreshCw, Trash2, Undo2 } from 'lucide-react';

import { formatDateTime } from '@/lib/formatDate';
import RefreshButton from '@/components/ui/RefreshButton';
import RowActions from '@/components/ui/RowActions';
import SortHeader, { TABLE_HEADER_CLASS as headerClass } from '@/components/ui/SortHeader';
import StatusBadge from '@/components/ui/StatusBadge';
import TablePagination, { PAGE_SIZES } from '@/components/ui/TablePagination';
import TableSearch from '@/components/ui/TableSearch';
import TableSkeleton from '@/components/ui/TableSkeleton';
import LoadConfirmDialog from '@/components/upload/LoadConfirmDialog';
import RollbackDetailsDialog from '@/components/upload/RollbackDetailsDialog';
import {
  ROLLED_BACK_STATUS,
  UPLOAD_STATUS_LABELS,
  loadActionFor,
  searchUploads,
  sortUploadsByDate,
} from '@/app/utils/uploadHistory';
import { nextSort, paginate, resultCountLabel } from '@/app/utils/tableView';
import { vendorLabel } from '@/app/utils/retailerLabel';

const COLUMN_COUNT = 6;

/**
 * Recent uploads (GET /api/uploads/history), laid out like the promotion
 * overview: count, search and refresh above the table, the Uploaded column
 * sortable, and paging below. No filter bar; the list is short enough that
 * search covers it.
 *
 * `months` is the window the page fetched, shown in the count line; the
 * filtering itself happens on the backend.
 *
 * A file whose mapping is approved but whose data is not loaded (or was
 * loaded with an older version) has a Load / Reload button beside its
 * status. It opens the load confirmation, so files are never forgotten once
 * the approval screen is closed.
 *
 * @param {{
 *   uploads: object[],
 *   isLoading: boolean,
 *   error: string,
 *   onRefresh: () => void,
 *   onRollback: (upload: object) => void,
 *   onDelete: (upload: object) => void,
 *   onLoaded: (response: object) => void,
 *   months: number,
 * }} props
 */
export default function RecentUploads({
  uploads,
  isLoading,
  error,
  onRefresh,
  onRollback,
  onDelete,
  onLoaded,
  months,
}) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState({ field: 'uploaded_at', direction: 'desc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const [rollbackDetails, setRollbackDetails] = useState(null);
  const [loading, setLoading] = useState(null); // null | { blobPath, reload }

  const sorted = sortUploadsByDate(searchUploads(uploads, search), sort.direction);
  const { pageRows, currentPage, totalPages } = paginate(sorted, page, pageSize);
  const showTable = uploads.length > 0 || isLoading;
  const windowLabel = `last ${months} month${months === 1 ? '' : 's'}`;

  // Any change to what is listed goes back to page 1, where the result starts.
  const changeSearch = (value) => {
    setSearch(value);
    setPage(1);
  };

  const changeSort = (field) => {
    setSort((current) => nextSort(current, field));
    setPage(1);
  };

  const changePageSize = (size) => {
    setPageSize(size);
    setPage(1);
  };

  return (
    <section className="overflow-hidden rounded-lg border border-lavander bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h2 className="font-serif text-xl text-deep-violet-blue">Recent uploads</h2>
          <p className="text-sm text-deep-violet-blue/70" aria-live="polite">
            {isLoading && !uploads.length
              ? 'Loading uploads…'
              : `${resultCountLabel(sorted.length, uploads.length, 'upload')} · ${windowLabel}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <TableSearch
            value={search}
            onChange={changeSearch}
            label="Search uploads"
            placeholder="Search file, customer, nomenclature…"
          />
          <RefreshButton
            onClick={onRefresh}
            isRefreshing={isLoading}
            label="Refresh uploads"
            className="rounded-md border-deep-violet-blue/30 bg-white text-deep-violet-blue hover:bg-cream"
          />
        </div>
      </div>

      {error && (
        <p className="mx-4 mb-3 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
          {error}
        </p>
      )}

      {!error && !showTable && (
        <p className="px-4 pb-4 text-sm text-deep-violet-blue/80">
          Nothing has been uploaded.
        </p>
      )}

      {showTable && (
        <>
          <div className="overflow-x-auto border-t border-lavander">
            <table className="w-full whitespace-nowrap text-left text-sm text-deep-violet-blue [&_td]:align-middle [&_th]:align-middle">
              <thead>
                <tr className="h-10 border-b border-lavander bg-cream/60">
                  <th scope="col" className={headerClass}>File</th>
                  <th scope="col" className={headerClass}>Customer</th>
                  <SortHeader
                    label="Uploaded"
                    field="uploaded_at"
                    sortField={sort.field}
                    sortDirection={sort.direction}
                    onSort={changeSort}
                  />
                  <th scope="col" className={headerClass}>Status</th>
                  <th scope="col" className={headerClass}>Nomenclature</th>
                  <th scope="col" className={headerClass}>Action</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && !uploads.length && <TableSkeleton columns={COLUMN_COUNT} rows={3} />}
                {!isLoading && uploads.length > 0 && sorted.length === 0 && (
                  <tr>
                    <td colSpan={COLUMN_COUNT} className="px-4 py-12 text-center text-deep-violet-blue/80">
                      No uploads match this search.
                    </td>
                  </tr>
                )}
                {pageRows.map((upload) => {
                  const status = upload.status === 'rolled_back'
                    ? ROLLED_BACK_STATUS
                    : UPLOAD_STATUS_LABELS[upload.mapping_status];
                  const load = loadActionFor(upload);
                  const actions = [];

                  if (load) {
                    actions.push({
                      key: load.reload ? 'reload' : 'load',
                      label: load.label,
                      icon: load.reload ? RefreshCw : Database,
                      onSelect: () => setLoading({
                        blobPath: upload.blob_path,
                        reload: load.reload,
                      }),
                    });
                  }
                  if (upload.status === 'rolled_back') {
                    actions.push({
                      key: 'rollback-details',
                      label: 'View rollback details',
                      icon: History,
                      onSelect: () => setRollbackDetails(upload),
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
                  const hasActiveLoad = upload.status !== 'rolled_back' && (
                    upload.rollback_available
                    || ['mapped', 'reload_available'].includes(upload.mapping_status)
                  );
                  const deletionBlocked = upload.status === 'processing'
                    ? 'Wait for this load to finish'
                    : hasActiveLoad
                      ? 'Rollback this upload first'
                      : null;
                  actions.push({
                    key: 'delete',
                    label: 'Delete upload',
                    icon: Trash2,
                    onSelect: () => onDelete(upload),
                    disabledReason: deletionBlocked,
                    destructive: true,
                  });

                  return (
                    <tr
                      key={upload.blob_path}
                      className="h-12 border-b border-lavander/80 bg-white transition-colors last:border-b-0 hover:bg-cream/50"
                    >
                      <td className="px-4 py-2.5 font-medium" title={upload.filename}>
                        <span className="block max-w-[18rem] truncate">{upload.filename}</span>
                      </td>
                      <td className="px-4 py-2.5">{vendorLabel(upload.vendor) || '—'}</td>
                      <td className="px-4 py-2.5">{formatDateTime(upload.uploaded_at)}</td>
                      <td className="px-4 py-2.5">
                        {status ? (
                          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                        ) : (
                          <StatusBadge tone="neutral">{upload.mapping_status || 'Unknown'}</StatusBadge>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        {upload.mapping_fingerprint && upload.mapping_available ? (
                          <Link
                            href={`/mappings/${upload.mapping_fingerprint}`}
                            title={upload.mapping_name || undefined}
                            className="block max-w-[16rem] truncate font-medium underline underline-offset-2 hover:opacity-80"
                          >
                            {/* Once a mapping is approved under a name, that name
                                is what identifies it here. */}
                            {upload.mapping_name || 'View nomenclature'}
                          </Link>
                        ) : (
                          <span className="text-deep-violet-blue/60">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <RowActions
                          label={`Actions for upload ${upload.filename}`}
                          actions={actions}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <TablePagination
            page={currentPage}
            totalPages={totalPages}
            pageSize={pageSize}
            totalRows={sorted.length}
            onPageChange={setPage}
            onPageSizeChange={changePageSize}
          />
        </>
      )}
      <RollbackDetailsDialog
        open={Boolean(rollbackDetails)}
        upload={rollbackDetails}
        onClose={() => setRollbackDetails(null)}
      />
      <LoadConfirmDialog
        open={loading !== null}
        blobPaths={loading ? [loading.blobPath] : []}
        reload={Boolean(loading?.reload)}
        onClose={() => setLoading(null)}
        onLoaded={onLoaded}
      />
    </section>
  );
}
