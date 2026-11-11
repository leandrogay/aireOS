'use client';

import { useState } from 'react';

import MobileRecordCard from '@/components/ui/MobileRecordCard';
import PaginatedDataTable from '@/components/ui/PaginatedDataTable';
import RowActions from '@/components/ui/RowActions';
import { PAGE_SIZES } from '@/components/ui/TablePagination';
import TableSearch from '@/components/ui/TableSearch';
import LoadConfirmDialog from '@/components/upload/LoadConfirmDialog';
import RollbackDetailsDialog from '@/components/upload/RollbackDetailsDialog';
import UploadRow, { NomenclatureLink, UploadStatusBadge, uploadRowActions } from '@/components/upload/UploadRow';
import { formatDateTime } from '@/lib/formatDate';
import { searchUploads, sortUploads } from '@/app/utils/uploadHistory';
import { nextSort, paginate } from '@/app/utils/tableView';
import { vendorLabel } from '@/app/utils/retailerLabel';

import { UPLOAD_COLUMNS } from './columns';

/**
 * Recent uploads (GET /api/uploads/history), in the shared list table
 * (ui/PaginatedDataTable) like the promotion overview: count, search and
 * refresh above the table, the Status and Uploaded columns sortable, and
 * paging below. It opens sorted by Status, so what needs acting on (a failed
 * nomenclature, a review, a load waiting) is at the top. Titled, because the upload page holds other sections too. No filter bar;
 * the list is short enough that search covers it.
 *
 * A file whose mapping is approved but whose data is not loaded (or was
 * loaded with an older version) has Load / Reload in its "…" menu. It opens
 * the load confirmation, so files are never forgotten once the approval
 * screen is closed.
 *
 * @param {{
 *   uploads: object[],
 *   isLoading: boolean,
 *   error: string,
 *   onRefresh: () => void,
 *   onRollback: (upload: object) => void,
 *   onDelete: (upload: object) => void,
 *   onLoaded: (response: object) => void,
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
}) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState({ field: 'status', direction: 'asc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const [rollbackDetails, setRollbackDetails] = useState(null);
  const [loading, setLoading] = useState(null); // null | { blobPath, reload }

  const sorted = sortUploads(searchUploads(uploads, search), sort);
  const { pageRows, currentPage, totalPages } = paginate(sorted, page, pageSize);
  const handlers = { onLoad: setLoading, onRollbackDetails: setRollbackDetails, onRollback, onDelete };

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
    <>
      <PaginatedDataTable
        label="Recent uploads"
        title="Recent uploads"
        noun="upload"
        totalCount={uploads.length}
        shownCount={sorted.length}
        isLoading={isLoading}
        error={error || null}
        onRefresh={onRefresh}
        emptyMessage="Nothing has been uploaded."
        toolbar={(
          <TableSearch
            value={search}
            onChange={changeSearch}
            label="Search uploads"
            placeholder="Search file, customer, nomenclature…"
          />
        )}
        columns={UPLOAD_COLUMNS}
        minWidth="48rem"
        sort={sort}
        onSort={changeSort}
        skeletonRows={3}
        emptyState={uploads.length > 0 && sorted.length === 0 ? 'No uploads match this search.' : null}
        pagination={{
          page: currentPage,
          totalPages,
          pageSize,
          totalRows: sorted.length,
          onPageChange: setPage,
          onPageSizeChange: changePageSize,
        }}
        mobileContent={(
          <div className="grid gap-2">
            {pageRows.map((upload) => (
              <MobileRecordCard
                key={upload.blob_path}
                title={upload.filename}
                subtitle={vendorLabel(upload.vendor) || undefined}
                badge={<UploadStatusBadge upload={upload} />}
                actions={<RowActions label={`Actions for upload ${upload.filename}`} actions={uploadRowActions(upload, handlers)} />}
                fields={[
                  { label: 'Uploaded', value: formatDateTime(upload.uploaded_at) },
                  { label: 'Nomenclature', value: <NomenclatureLink upload={upload} /> },
                ]}
              />
            ))}
          </div>
        )}
      >
        {pageRows.map((upload) => (
          <UploadRow key={upload.blob_path} upload={upload} actions={uploadRowActions(upload, handlers)} />
        ))}
      </PaginatedDataTable>

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
    </>
  );
}
