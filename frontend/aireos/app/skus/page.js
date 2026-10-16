'use client';

import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';

import PageLayout from '@/components/layout/PageLayout';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { Button } from '@/components/ui/button';
import Toast from '@/components/ui/Toast';
import SkuDetails from '@/components/skus/SkuDetails';
import SkuFilters from '@/components/skus/SkuFilters';
import SkuForm from '@/components/skus/SkuForm';
import SkuTable from '@/components/skus/SkuTable';
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
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editor, setEditor] = useState(null);
  const [details, setDetails] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState('');
  const [pendingArchive, setPendingArchive] = useState(null);
  const [archiving, setArchiving] = useState(false);
  const { toast, notify, dismissToast } = useToast();

  useEffect(() => {
    let cancelled = false;
    Promise.all([getSkus(), getSkuOptions()])
      .then(([rows, values]) => {
        if (cancelled) return;
        setSkus(rows);
        setOptions(values);
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError.message || 'Failed to load the SKU catalogue.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const filtered = skus.filter((sku) => {
    if (!matchesSearch([sku.sku, sku.sku_range, sku.product_name], search)) return false;
    if (filters.skuRange && sku.sku_range !== filters.skuRange) return false;
    if (filters.brand && sku.brand !== filters.brand) return false;
    if (filters.minPrice !== '' && Number(sku.price) < Number(filters.minPrice)) return false;
    if (filters.maxPrice !== '' && Number(sku.price) > Number(filters.maxPrice)) return false;
    return true;
  });
  const { pageRows, currentPage, totalPages } = paginate(filtered, page, pageSize);

  const changeSearch = (value) => { setSearch(value); setPage(1); };
  const changeFilter = (key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
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

  const viewSku = async (sku) => {
    setDetails(sku);
    setDetailsLoading(true);
    setDetailsError('');
    try {
      setDetails(await getSku(sku.sku));
    } catch (viewError) {
      setDetailsError(viewError.message || 'Failed to load SKU details.');
    } finally {
      setDetailsLoading(false);
    }
  };

  const confirmArchive = async () => {
    if (!pendingArchive) return;
    setArchiving(true);
    try {
      await archiveSku(pendingArchive.sku);
      setSkus((current) => current.filter((item) => item.sku !== pendingArchive.sku));
      notify('deleted', `SKU ${pendingArchive.sku} moved to the archived catalogue.`);
      setPendingArchive(null);
    } catch (archiveError) {
      notify('error', archiveError.message || 'Failed to archive SKU.');
      setPendingArchive(null);
    } finally {
      setArchiving(false);
    }
  };

  return (
    <PageLayout
      title="SKU catalogue"
      fitScreen
      headerExtra={<Button onClick={() => setEditor({ sku: null })}><Plus />Create SKU</Button>}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <SkuFilters
          search={search}
          filters={filters}
          values={options}
          onSearch={changeSearch}
          onChange={changeFilter}
          onReset={() => { setSearch(''); setFilters(EMPTY_FILTERS); setPage(1); }}
        />
        <SkuTable
          rows={pageRows}
          total={filtered.length}
          loading={loading}
          error={error}
          page={currentPage}
          pageSize={pageSize}
          totalPages={totalPages}
          onPageChange={setPage}
          onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
          onView={viewSku}
          onEdit={(sku) => setEditor({ sku })}
          onDelete={setPendingArchive}
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
        onEdit={(sku) => { setDetails(null); setEditor({ sku }); }}
      />
      <ConfirmDialog
        open={Boolean(pendingArchive)}
        title="Delete this SKU?"
        description="It will leave the active catalogue but remain available to historical sales and inventory records."
        details={pendingArchive ? [
          { label: 'SKU', value: pendingArchive.sku },
          { label: 'Product', value: pendingArchive.product_name },
        ] : []}
        confirmLabel="Delete SKU"
        pendingLabel="Deleting…"
        isPending={archiving}
        onConfirm={confirmArchive}
        onCancel={() => setPendingArchive(null)}
      />
      <Toast toast={toast} onDismiss={dismissToast} />
    </PageLayout>
  );
}
