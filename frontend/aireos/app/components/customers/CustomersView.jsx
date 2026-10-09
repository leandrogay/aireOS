'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';

import PageLayout from '@/components/layout/PageLayout';
import { Button } from '@/components/ui/button';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Toast from '@/components/ui/Toast';
import useCustomers from '@/hooks/useCustomers';
import useToast from '@/hooks/useToast';
import {
  createCustomer,
  createRetailer,
  deleteCustomer,
  deleteRetailer,
  linkRetailer,
  updateCustomer,
  updateRetailer,
} from '@/app/services/catalogApi';
import { allRetailerNames, normaliseName } from '@/app/utils/customerForm';
import { retailerLabel } from '@/app/utils/retailerLabel';

import CustomerTable from './CustomerTable';
import LinkRetailerDialog from './LinkRetailerDialog';
import NameFormDialog from './NameFormDialog';
import UnlinkedRetailers from './UnlinkedRetailers';

/**
 * Every value the name dialog needs for one kind of edit. `takenNames` holds
 * the other records' slugs, so the form flags a duplicate before sending
 * (the backend checks again).
 *
 * @param {{ type: string, customer?: object, retailer?: object }} dialog
 * @param {object[]} customers
 * @param {object[]} unlinked
 */
function nameDialogProps(dialog, customers, unlinked) {
  const { type, customer, retailer } = dialog;

  if (type === 'customer-create' || type === 'customer-edit') {
    const isEdit = type === 'customer-edit';
    const others = customers.filter((row) => row.customer_id !== customer?.customer_id);
    return {
      formKey: `${type}-${customer?.customer_id ?? 'new'}`,
      title: isEdit ? `Edit customer — ${retailerLabel(customer.customer_name)}` : 'Add customer',
      fieldLabel: 'Customer name',
      kind: 'customer',
      initialName: isEdit ? customer.customer_name : '',
      takenNames: new Set(others.map((row) => normaliseName(row.customer_name))),
      submitLabel: isEdit ? 'Save changes' : 'Add customer',
      pendingLabel: isEdit ? 'Saving changes…' : 'Adding customer…',
    };
  }

  const isEdit = type === 'retailer-edit';
  const taken = allRetailerNames(customers, unlinked)
    .filter((name) => name !== retailer?.retailer_name)
    .map(normaliseName);
  return {
    formKey: `${type}-${retailer?.retailer_id ?? customer.customer_id}`,
    title: isEdit
      ? `Edit retailer — ${retailerLabel(retailer.retailer_name)}`
      : `Add retailer to ${retailerLabel(customer.customer_name)}`,
    fieldLabel: 'Retailer name',
    kind: 'retailer',
    initialName: isEdit ? retailer.retailer_name : '',
    takenNames: new Set(taken),
    submitLabel: isEdit ? 'Save changes' : 'Add retailer',
    pendingLabel: isEdit ? 'Saving changes…' : 'Adding retailer…',
  };
}

/**
 * The Customers page: customers (customers table) and the retailers under
 * each (customer_retailers), with add, rename and delete for both, and
 * linking for retailers created without a customer. Every write answers with
 * the affected customer row, which replaces that row in place
 * (useCustomers); the refresh button refetches everything.
 */
export default function CustomersView() {
  const [refreshKey, setRefreshKey] = useState(0);
  const { data, unlinked, loading, error, applyCustomer, removeCustomer, applyUnlinked, removeUnlinked } =
    useCustomers({ refreshKey });
  const { toast, notify, dismissToast } = useToast();
  // { type: 'customer-create' | 'customer-edit' | 'retailer-create' | 'retailer-edit', customer?, retailer? }
  const [dialog, setDialog] = useState(null);
  const [linking, setLinking] = useState(null);
  // { customer } for a customer, { retailer, customer } for a retailer (customer null when unlinked).
  const [pendingDelete, setPendingDelete] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const [highlightId, setHighlightId] = useState(null);

  function refresh() {
    setRefreshKey((key) => key + 1);
  }

  function toggleExpanded(customerId) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(customerId)) next.delete(customerId);
      else next.add(customerId);
      return next;
    });
  }

  function showCustomer(customer) {
    applyCustomer(customer);
    setHighlightId(customer.customer_id);
    setExpandedIds((current) => new Set(current).add(customer.customer_id));
  }

  // A 409 can mean the record gained data since the list loaded (it is now
  // in use), so reload to bring the menus' disabled states up to date.
  function refreshOnConflict(err) {
    if (err.status === 409) refresh();
  }

  async function saveName(name) {
    const { type, customer, retailer } = dialog;
    try {
      if (type === 'customer-create') {
        const created = await createCustomer({ customer_name: name });
        applyCustomer(created);
        setHighlightId(created.customer_id);
        notify('created', `Customer ${retailerLabel(created.customer_name)} added`);
      } else if (type === 'customer-edit') {
        const updated = await updateCustomer(customer.customer_id, { customer_name: name });
        applyCustomer(updated);
        setHighlightId(updated.customer_id);
        notify('updated', `Customer renamed to ${retailerLabel(updated.customer_name)}`);
      } else if (type === 'retailer-create') {
        const result = await createRetailer({ retailer_name: name, customer_id: customer.customer_id });
        showCustomer(result.customer);
        notify('created', `Retailer ${retailerLabel(result.retailer.retailer_name)} added`);
      } else {
        const result = await updateRetailer(retailer.retailer_id, { retailer_name: name });
        if (result.customer) showCustomer(result.customer);
        else applyUnlinked(result.retailer);
        notify('updated', `Retailer renamed to ${retailerLabel(result.retailer.retailer_name)}`);
      }
      setDialog(null);
    } catch (err) {
      refreshOnConflict(err);
      // The dialog shows the message under its field.
      throw err;
    }
  }

  async function saveLink(customerId) {
    try {
      const result = await linkRetailer(linking.retailer_id, { customer_id: customerId });
      showCustomer(result.customer);
      notify(
        'updated',
        `${retailerLabel(result.retailer.retailer_name)} linked to ${retailerLabel(result.customer.customer_name)}`,
      );
      setLinking(null);
    } catch (err) {
      refreshOnConflict(err);
      throw err;
    }
  }

  async function confirmDelete() {
    const { customer, retailer } = pendingDelete;
    setIsDeleting(true);
    try {
      if (retailer) {
        const result = await deleteRetailer(retailer.retailer_id);
        if (result.customer) applyCustomer(result.customer);
        else removeUnlinked(retailer.retailer_id);
        notify('deleted', `Retailer ${retailerLabel(retailer.retailer_name)} deleted`);
      } else {
        await deleteCustomer(customer.customer_id);
        removeCustomer(customer.customer_id);
        notify('deleted', `Customer ${retailerLabel(customer.customer_name)} deleted`);
      }
    } catch (err) {
      // The row stays in the list; the toast carries the backend's reason.
      notify('error', err.message);
      refreshOnConflict(err);
    } finally {
      setIsDeleting(false);
      setPendingDelete(null);
    }
  }

  const deleteDetails = pendingDelete?.retailer
    ? [
        { label: 'Retailer', value: retailerLabel(pendingDelete.retailer.retailer_name) },
        {
          label: 'Customer',
          value: pendingDelete.customer ? retailerLabel(pendingDelete.customer.customer_name) : 'None',
        },
      ]
    : pendingDelete
      ? [{ label: 'Customer', value: retailerLabel(pendingDelete.customer.customer_name) }]
      : [];

  return (
    <PageLayout
      title="Customers"
      headerExtra={
        <Button
          onClick={() => setDialog({ type: 'customer-create' })}
          className="ml-auto bg-deep-violet-blue text-white hover:bg-deep-violet-blue/90"
        >
          <Plus data-icon="inline-start" />
          Add customer
        </Button>
      }
    >
      <div className="grid gap-1">
        <CustomerTable
          customers={data}
          loading={loading}
          error={error}
          expandedIds={expandedIds}
          highlightId={highlightId}
          onToggle={toggleExpanded}
          onRefresh={refresh}
          onEdit={(customer) => setDialog({ type: 'customer-edit', customer })}
          onDelete={(customer) => setPendingDelete({ customer })}
          onAddRetailer={(customer) => setDialog({ type: 'retailer-create', customer })}
          onEditRetailer={(retailer, customer) => setDialog({ type: 'retailer-edit', retailer, customer })}
          onDeleteRetailer={(retailer, customer) => setPendingDelete({ retailer, customer })}
        />

        <UnlinkedRetailers
          retailers={unlinked}
          onLink={setLinking}
          onEdit={(retailer) => setDialog({ type: 'retailer-edit', retailer })}
          onDelete={(retailer) => setPendingDelete({ retailer, customer: null })}
        />

        <p className="mt-1 px-1 text-xs text-deep-violet-blue/60">
          A customer or retailer that already has sales or inventory data can&apos;t be renamed or
          deleted: dashboards, uploads and forecasts find it by its name.
        </p>
      </div>

      <NameFormDialog
        open={Boolean(dialog)}
        onClose={() => setDialog(null)}
        onSubmit={saveName}
        {...(dialog ? nameDialogProps(dialog, data, unlinked) : { formKey: 'closed', takenNames: new Set() })}
      />

      <LinkRetailerDialog
        retailer={linking}
        customers={data}
        onSubmit={saveLink}
        onClose={() => setLinking(null)}
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={pendingDelete?.retailer ? 'Delete this retailer?' : 'Delete this customer?'}
        description="It will be removed permanently. This can’t be undone."
        details={deleteDetails}
        confirmLabel={pendingDelete?.retailer ? 'Delete retailer' : 'Delete customer'}
        pendingLabel="Deleting…"
        isPending={isDeleting}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />

      <Toast toast={toast} onDismiss={dismissToast} />
    </PageLayout>
  );
}
