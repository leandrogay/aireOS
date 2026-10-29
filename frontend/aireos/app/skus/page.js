'use client';

import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';

import PageLayout from '@/components/layout/PageLayout';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { PAGE_SIZES } from '@/components/ui/TablePagination';
import Toast from '@/components/ui/Toast';
import SkuDetails from '@/components/skus/SkuDetails';
import SkuFilters from '@/components/skus/SkuFilters';
import SkuForm from '@/components/skus/SkuForm';
import SkuTable from '@/components/skus/SkuTable';
import useConfirmAction from '@/hooks/useConfirmAction';
import useToast from '@/hooks/useToast';
import { paginate, matchesSearch } from '@/app/utils/tableView';
import {
  archiveSku,
  createSku,
  getSku,
  getSkuOptions,
  getSkus,
  updateSku,
} from '@/app/services/catalogApi';

const EMPTY_FILTERS = { skuRange: '', brand: '', minPrice: '', maxPrice: '' };

export default function SkusPage() {
  const [skus, setSkus] = useState([]);
  const [options, setOptions] = useState({});
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editor, setEditor] = useState(null);
  const [details, setDetails] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState('');
  const { toast, notify, dismissToast } = useToast();
  const deletion = useConfirmAction({ onConfirm: archiveRecord });

  useEffect(() => {
    let cancelled = false;
    Promise.all([getSkus(), getSkuOptions()])
      .then(([rows, values]) => {
        if (cancelled) return;
        setSkus(rows);
        setOptions(values);
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError.message || 'Failed to load the SKU catalog.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [refreshKey]);

  const filtered = skus.filter((sku) => {
    if (!matchesSearch([sku.sku, sku.sku_range, sku.product_name], search)) return false;
    if (filters.skuRange && sku.sku_range !== filters.skuRange) return false;
    if (filters.brand && sku.brand !== filters.brand) return false;
    if (filters.minPrice !== '' && Number(sku.price) < Number(filters.minPrice)) return false;
    if (filters.maxPrice !== '' && Number(sku.price) > Number(filters.maxPrice)) return false;
    return true;
  });
  const { pageRows, currentPage, totalPages } = paginate(filtered, page, pageSize);
  const hasFilters = search.trim() !== '' || Object.values(filters).some((value) => value !== '');

  const changeSearch = (value) => { setSearch(value); setPage(1); };
  const changeFilter = (key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  };
  const refreshCatalog = () => {
    setLoading(true);
    setError('');
    setRefreshKey((current) => current + 1);
  };

  const saveSku = async (payload) => {
    const saved = editor.sku
      ? await updateSku(editor.sku.sku, payload)
      : await createSku(payload);
    setSkus((current) => {
      const withoutSaved = current.filter((item) => item.sku !== saved.sku);
      return [...withoutSaved, saved].sort((left, right) => left.product_name.localeCompare(right.product_name));
    });
    setOptions(await getSkuOptions());
    notify(editor.sku ? 'updated' : 'created', editor.sku ? `SKU ${saved.sku} updated.` : `SKU ${saved.sku} created.`);
    setEditor(null);
  };

  const viewSkuHistory = async (sku) => {
    setDetails(sku);
    setDetailsLoading(true);
    setDetailsError('');
    try {
      setDetails(await getSku(sku.sku));
    } catch (viewError) {
      setDetailsError(viewError.message || 'Failed to load SKU history.');
    } finally {
      setDetailsLoading(false);
    }
  };

  async function archiveRecord(sku) {
    try {
      await archiveSku(sku.sku);
      setSkus((current) => current.filter((item) => item.sku !== sku.sku));
      try {
        setOptions(await getSkuOptions());
      } catch (optionsError) {
        setError(
          optionsError.message ||
            `SKU ${sku.sku} was archived, but the catalog options could not be refreshed.`,
        );
      }
      notify('deleted', `SKU ${sku.sku} was archived.`);
    } catch (archiveError) {
      notify('error', archiveError.message || 'Failed to archive SKU.');
    }
  }

  return (
    <PageLayout
      title="SKU catalog"
      fitScreen
      headerExtra={(
        <Button
          onClick={() => setEditor({ sku: null })}
          className="ml-auto bg-deep-violet-blue text-white hover:bg-deep-violet-blue/90"
        >
          <Plus data-icon="inline-start" />
          Create SKU
        </Button>
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <SkuFilters
          filters={filters}
          values={options}
          hasFilters={hasFilters}
          onChange={changeFilter}
          onReset={() => { setSearch(''); setFilters(EMPTY_FILTERS); setPage(1); }}
        />
        <SkuTable
          rows={pageRows}
          total={filtered.length}
          totalCount={skus.length}
          search={search}
          loading={loading}
          error={error}
          page={currentPage}
          pageSize={pageSize}
          totalPages={totalPages}
          onPageChange={setPage}
          onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
          onHistory={viewSkuHistory}
          onEdit={(sku) => setEditor({ sku })}
          onDelete={deletion.request}
          onRefresh={refreshCatalog}
          onSearch={changeSearch}
        />
      </div>

      {editor && (
        <SkuForm
          open
          sku={editor.sku}
          options={options}
          onSave={saveSku}
          onClose={() => setEditor(null)}
        />
      )}
      <SkuDetails
        open={Boolean(details)}
        sku={details}
        loading={detailsLoading}
        error={detailsError}
        onClose={() => setDetails(null)}
      />
      <ConfirmDialog
        open={Boolean(deletion.target)}
        title="Delete this SKU?"
        description="It will leave the active catalog but remain available to historical sales and inventory records."
        details={deletion.target ? [
          { label: 'SKU', value: deletion.target.sku },
          { label: 'Product', value: deletion.target.product_name },
        ] : []}
        confirmLabel="Delete SKU"
        pendingLabel="Deleting…"
        isPending={deletion.isPending}
        onConfirm={deletion.confirm}
        onCancel={deletion.cancel}
      />
      <Toast toast={toast} onDismiss={dismissToast} />
    </PageLayout>
  );
}
