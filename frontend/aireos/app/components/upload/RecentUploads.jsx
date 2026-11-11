'use client';

import { useState } from 'react';

import MobileRecordCard from '@/components/ui/MobileRecordCard';
import RecordCardList from '@/components/ui/RecordCardList';
import PaginatedDataTable from '@/components/ui/PaginatedDataTable';
import RowActions from '@/components/ui/RowActions';
import { PAGE_SIZES } from '@/components/ui/TablePagination';
import TableSearch from '@/components/ui/TableSearch';
import LoadConfirmDialog from '@/components/upload/LoadConfirmDialog';
import RollbackDetailsDialog from '@/components/upload/RollbackDetailsDialog';
import UploadRow, { NomenclatureLink, UploadStatusBadge, uploadRowActions } from '@/components/upload/UploadRow';
import { formatDateTime } from '@/lib/formatDate';
import { blockQuery, nextSort, pageFromBlock } from '@/app/utils/tableView';
import { UPLOAD_HISTORY_BLOCK } from '@/app/config/upload';
import { vendorLabel } from '@/app/utils/retailerLabel';
import useUploadHistory from '@/hooks/useUploadHistory';

import { UPLOAD_COLUMNS } from './columns';

/**
 * Recent uploads (GET /api/uploads/history), in the shared list table
 * (ui/PaginatedDataTable) like the promotion overview: count, search and
 * refresh above the table, the Status and Uploaded columns sortable, and
 * paging below. It opens sorted by Status, so what needs acting on (a failed
 * nomenclature, a review, a load waiting) is at the top. Titled, because the upload page holds other sections too. No filter bar;
 * search covers it.
 *
 * Unlike the other list tables, the backend searches, sorts and pages
 * (useUploadHistory), because the bucket holds every upload ever made; this
 * component only keeps the query. It asks for a block of
 * UPLOAD_HISTORY_BLOCK rows and pages through it here, so Next / Prev inside
 * the block are instant; only search, sort, Refresh or leaving the block ask
 * the backend again. Every upload is listed, however old: this is the only
 * place to roll one back, delete or reload it. `refreshKey` changes when the
 * page knows the list moved (an upload finished, a load, rollback or delete).
 *
 * A file whose mapping is approved but whose data is not loaded (or was
 * loaded with an older version) has Load / Reload in its "…" menu. It opens
 * the load confirmation, so files are never forgotten once the approval
 * screen is closed.
 *
 * @param {{
 *   refreshKey: number,
 *   onRollback: (upload: object) => void,
 *   onDelete: (upload: object) => void,
 *   onLoaded: (response: object) => void,
 * }} props
 */
export default function RecentUploads({
  refreshKey,
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
  // Refresh and Retry: the same query asked again.
  const [reloads, setReloads] = useState(0);

  const history = useUploadHistory({
    ...blockQuery(page, pageSize, UPLOAD_HISTORY_BLOCK),
    search,
    sort: sort.field,
    direction: sort.direction,
    refreshKey: `${refreshKey}:${reloads}`,
  });
  const block = history.data && {
    rows: history.data.uploads,
    offset: history.data.offset,
    total: history.data.total,
  };
  const { pageRows, currentPage, totalPages } = pageFromBlock(block, page, pageSize);
  const matching = history.data?.total ?? 0;
  const everything = history.data?.unfiltered_total ?? 0;
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
        totalCount={everything}
        shownCount={matching}
        isLoading={history.loading}
        error={history.error}
        onRefresh={() => setReloads((count) => count + 1)}
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
        emptyState={everything > 0 && matching === 0 ? 'No uploads match this search.' : null}
        pagination={{
          page: currentPage,
          totalPages,
          pageSize,
          totalRows: matching,
          onPageChange: setPage,
          onPageSizeChange: changePageSize,
        }}
        mobileContent={(
          <RecordCardList>
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
          </RecordCardList>
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
