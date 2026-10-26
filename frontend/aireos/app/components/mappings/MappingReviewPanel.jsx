'use client';

import { useEffect, useState } from 'react';
import { Loader2, Play } from 'lucide-react';

import { Button } from '@/components/ui/button';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Disclosure from '@/components/ui/Disclosure';
import { secondaryButtonClass } from '@/components/inventory/formStyles';
import useCustomers from '@/hooks/useCustomers';
import useMappingEdits from '@/hooks/useMappingEdits';
import { createRetailer, linkRetailer } from '@/app/services/catalogApi';
import { checkSummary } from '@/app/utils/mappingChecks';
import {
  newCustomerDefaults,
  retailerDecision,
  retailerOutputs,
  retailerStatuses,
  suggestCustomerId,
} from '@/app/utils/mappingCustomer';
import { PROPOSER, reviewIssues } from '@/app/utils/mappingReview';
import { SECTION_IDS, reviewChecklist } from '@/app/utils/reviewChecklist';
import { codeRows, unknownCodes } from '@/app/utils/skuCodeTable';
import { cn } from '@/lib/utils';

import ApprovedSummary from './ApprovedSummary';
import ConfirmDiscardDialog from './ConfirmDiscardDialog';
import CustomerStep from './CustomerStep';
import FieldTable from './FieldTable';
import MappingChecks from './MappingChecks';
import NewCustomerDialog from './NewCustomerDialog';
import OutputPreview from './OutputPreview';
import ReviewChecklist from './ReviewChecklist';
import ReviewHeader from './ReviewHeader';
import ResetButton from './ResetButton';
import ReviewSection from './ReviewSection';
import SkuCodeTable from './SkuCodeTable';
import UnusedColumns from './UnusedColumns';

const done = (items, ids) => items.filter((item) => ids.includes(item.id)).every((item) => item.done);

/**
 * The human-in-the-loop review of one mapping, as numbered steps in the
 * order a reviewer works -- whose file it is, where each field comes from,
 * which of our products each code is, and whether it all checks out -- with
 * a "What's left" list beside them that says what approval still waits on.
 *
 * @param {{
 *   mapping: object,
 *   onApprove: (payload: { rules: object[], name: string, customer_id: number }) => Promise<object>,
 *   onDiscard?: () => Promise<void>,
 *   onPreview: (rules: object[]) => Promise<object>,
 * }} props
 */
export default function MappingReviewPanel({ mapping, onApprove, onDiscard, onPreview }) {
  const edits = useMappingEdits({ mapping });
  const customers = useCustomers();
  const [name, setName] = useState(mapping.name || '');
  // null until the customers load; then the reviewer's pick, or a suggestion.
  const [customerChoice, setCustomerChoice] = useState(null);
  // The new-customer form, open with a name to start from ('' for the
  // suggestion from the file), or null while closed.
  const [newCustomerName, setNewCustomerName] = useState(null);
  const [busy, setBusy] = useState(null); // null | 'approve' | 'discard' | 'preview'
  const [message, setMessage] = useState('');
  const [approved, setApproved] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState('');
  const [isConfirmingDiscard, setIsConfirmingDiscard] = useState(false);
  // The step whose Reset is waiting on "are you sure?": 'fields' | 'products' | null.
  const [confirmingReset, setConfirmingReset] = useState(null);
  const [discardError, setDiscardError] = useState('');

  const decision = retailerDecision(mapping, edits.rows, edits.fieldEdits);
  const outputs = retailerOutputs(decision);

  // The starting customer is settled once, when the list arrives: the one the
  // mapping was saved under, else one its retailers point at. Set during
  // render (the one-time-default case) so the page never shows a blank
  // customer it is about to fill in.
  if (!customerChoice && !customers.loading) {
    const suggestion = suggestCustomerId(mapping, customers.data, outputs);
    setCustomerChoice({ id: suggestion, suggested: Boolean(suggestion) && !mapping.customerId });
  }
  const customer = customers.data.find((item) => item.customer_id === customerChoice?.id) || null;
  const statuses = retailerStatuses(outputs, customer, customers.data, customers.unlinked);

  const issues = reviewIssues(mapping, edits.state);

  // The product-code table lives on the sku field's transforms. Codes come
  // from the latest run when there is one (the sku may have been repointed).
  const skuField = edits.rows
    .flatMap((row) => row.fields)
    .find((field) => field.targetField === 'sku');
  const masterAvailable = mapping.masterSkusAvailable !== false;
  const codes = skuField ? codeRows(preview?.sku_codes || mapping.skuCodes, skuField.transform, mapping.masterSkus) : [];
  const unknown = masterAvailable ? unknownCodes(codes) : [];

  // Checks are the proposal's until the reviewer runs them, and go stale the
  // moment the rules differ from the ones they ran on.
  const rulesKey = JSON.stringify(edits.rules);
  const checks = preview ? preview.checks : mapping.checks;
  const stale = preview ? preview.rulesKey !== rulesKey : edits.changed;
  const failed = checkSummary(checks).failed;

  const changed =
    edits.changed || name.trim() !== (mapping.name || '') || (customer?.customer_id ?? null) !== (mapping.customerId ?? null);

  const items = reviewChecklist({
    name,
    customer,
    outputs,
    statuses,
    issues,
    codes,
    unknownCodes: unknown,
    masterAvailable,
    checks: { failed, stale },
  });

  // Leaving with unsaved edits loses them, so the browser asks first.
  useEffect(() => {
    if (!changed || approved) return undefined;
    const warn = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [changed, approved]);

  // A retailer the mapping writes to, made the customer's: added when no
  // retailer has the name, linked when an upload already made it.
  async function fixRetailer(item) {
    const result =
      item.status === 'new'
        ? await createRetailer({ retailer_name: item.name, customer_id: customer.customer_id })
        : await linkRetailer(item.retailerId, { customer_id: customer.customer_id });
    customers.applyCustomer(result.customer);
  }

  function handleCustomerCreated(created) {
    customers.applyCustomer(created);
    setCustomerChoice({ id: created.customer_id, suggested: false });
    setNewCustomerName(null);
  }

  async function runChecks() {
    setBusy('preview');
    setPreviewError('');
    try {
      setPreview({ ...(await onPreview(edits.rules)), rulesKey });
    } catch (error) {
      setPreview(null);
      setPreviewError(error.message);
    } finally {
      setBusy(null);
    }
  }

  async function handleApprove() {
    setBusy('approve');
    setMessage('');
    try {
      setApproved(await onApprove({ rules: edits.rules, name: name.trim(), customer_id: customer.customer_id }));
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(null);
    }
  }

  // Discard only runs from the confirm dialog. On success the page navigates
  // away; on failure the dialog closes so the error under the header shows.
  async function handleDiscard() {
    setBusy('discard');
    setDiscardError('');
    try {
      await onDiscard();
    } catch (error) {
      setIsConfirmingDiscard(false);
      setDiscardError(error.message);
    } finally {
      setBusy(null);
    }
  }

  if (approved) return <ApprovedSummary approved={approved} />;

  const disabled = busy !== null;
  const steps = [SECTION_IDS.customer, SECTION_IDS.fields, ...(codes.length ? [SECTION_IDS.products] : []), SECTION_IDS.checks];
  const stepOf = (id) => steps.indexOf(id) + 1;
  const openFields = issues.coverage.filter(
    (entry) => entry.decidable && (entry.status === 'unmapped' || entry.status === 'not_available'),
  );

  // What each step's Reset puts back. Step 2 is every field in its table but
  // the retailer, which step 1 resets; step 3 is the product codes.
  const stepFields = issues.coverage
    .filter((entry) => entry.decidable && entry.field !== 'retailer')
    .map((entry) => entry.field);
  const canResetFields = edits.canResetFields(stepFields);
  const changedCodes = codes.map((row) => row.code).filter(edits.codeChanged);

  function confirmReset() {
    if (confirmingReset === 'fields') edits.resetFields(stepFields);
    if (confirmingReset === 'products') edits.resetSkuCodes(changedCodes);
    setConfirmingReset(null);
  }

  return (
    <div className="space-y-1">
      <ReviewHeader
        mapping={mapping}
        changed={changed}
        canDiscard={!!onDiscard && mapping.state === 'pending'}
        busy={busy}
        discardError={discardError}
        onDiscard={() => {
          setDiscardError('');
          setIsConfirmingDiscard(true);
        }}
      />

      <div className="grid gap-1 lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-start">
        <div className="min-w-0 space-y-1">
          <ReviewSection
            id={SECTION_IDS.customer}
            step={stepOf(SECTION_IDS.customer)}
            title="Whose file is this?"
            info="Name the mapping and choose the customer. Sales only reach the dashboard through the customer's retailers."
            done={done(items, ['name', 'customer', 'retailers'])}
          >
            <CustomerStep
              name={name}
              onNameChange={setName}
              customers={customers.data}
              customersLoading={customers.loading}
              customersError={customers.error}
              customer={customer}
              suggested={Boolean(customerChoice?.suggested)}
              legacyVendor={!mapping.customerId && mapping.state === 'confirmed' ? mapping.vendor : null}
              onCustomerChange={(id) => setCustomerChoice({ id, suggested: false })}
              onNewCustomer={setNewCustomerName}
              decision={decision}
              outputs={outputs}
              statuses={statuses}
              onFixRetailer={fixRetailer}
              onSetRetailerChoice={edits.setRetailerChoice}
              onSetConstant={edits.setRetailerConstant}
              retailerChanged={edits.retailerChanged}
              onResetRetailer={edits.resetRetailer}
              disabled={disabled}
            />
          </ReviewSection>

          <ReviewSection
            id={SECTION_IDS.fields}
            step={stepOf(SECTION_IDS.fields)}
            title="Where each field comes from"
            info={`Change a field by choosing another column — or, for Units sold and Sales value, a group of period or outlet columns. Confirm the low-confidence ones with “Looks right”. Each field's ⓘ has its details.`}
            done={done(items, ['required', 'confirm', 'duplicates'])}
            action={
              canResetFields && (
                <ResetButton
                  text="Reset step"
                  label={`Reset every field in this step to the ${PROPOSER}'s proposal`}
                  onClick={() => setConfirmingReset('fields')}
                  disabled={disabled}
                />
              )
            }
          >
            <FieldTable
              coverage={issues.coverage}
              mapping={mapping}
              rows={edits.rows}
              groups={edits.groups}
              confirmedNow={edits.confirmedNow}
              onAssign={edits.assignColumn}
              onChooseGroup={edits.chooseGroup}
              onClear={edits.clearField}
              onConfirm={edits.confirmField}
              onUndo={edits.undoConfirm}
              onGroupSettingsChange={edits.changeGroupSettings}
              canResetField={(field) => edits.canResetFields([field])}
              onResetField={(field) => edits.resetFields([field])}
              disabled={disabled}
            />
            <UnusedColumns
              rows={issues.unusedColumns}
              unusedGroups={issues.unusedGroups}
              mapping={mapping}
              groups={edits.groups}
              openFields={openFields}
              onAssign={edits.assignColumn}
              onChooseGroup={edits.chooseGroup}
              disabled={disabled}
            />
          </ReviewSection>

          {codes.length > 0 && (
            <ReviewSection
              id={SECTION_IDS.products}
              step={stepOf(SECTION_IDS.products)}
              title="Which of our products each code is"
              info="Every product code in the example file has to be one of our master SKUs. Pick the product for any code that is not, or add the product to the SKU master first."
              done={done(items, ['products'])}
              action={
                changedCodes.length > 0 && (
                  <ResetButton
                    text="Reset step"
                    label={`Reset every product code to the ${PROPOSER}'s proposal`}
                    onClick={() => setConfirmingReset('products')}
                    disabled={disabled}
                  />
                )
              }
            >
              <SkuCodeTable
                rows={codes}
                masterSkus={mapping.masterSkus || []}
                masterAvailable={masterAvailable}
                onChange={edits.setSkuCode}
                codeChanged={edits.codeChanged}
                onResetCode={(code) => edits.resetSkuCodes([code])}
                readOnly={disabled}
              />
            </ReviewSection>
          )}

          <ReviewSection
            id={SECTION_IDS.checks}
            step={stepOf(SECTION_IDS.checks)}
            title="Check it on the example file"
            info={`Runs the mapping on the whole example file and compares totals, periods and products with what the file says. ${preview ? 'Showing your last run.' : `Showing the results from when the ${PROPOSER} proposed it.`}`}
            done={!failed && !stale}
            doneLabel="Passing"
            todoLabel={stale ? 'Out of date' : 'Failing'}
            action={
              <Button type="button" variant="outline" disabled={disabled} onClick={runChecks} className={cn(secondaryButtonClass, 'h-7 px-2.5 text-xs')}>
                {busy === 'preview' ? <Loader2 aria-hidden="true" className="size-3.5 animate-spin" /> : <Play aria-hidden="true" className="size-3.5" />}
                {busy === 'preview' ? 'Running…' : preview ? 'Run again' : 'Run checks'}
              </Button>
            }
          >
            {previewError && (
              <p role="alert" className="mb-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                {previewError}
              </p>
            )}
            <MappingChecks checks={checks} />

            {/* Only once a run has rows to show -- an empty fold is a click
                that leads nowhere -- and open from the start then. */}
            {preview?.preview?.length > 0 && (
              <Disclosure open className="mt-2 rounded-md border border-lavander" summary="Sample sales rows">
                <div className="border-t border-lavander p-2">
                  <OutputPreview preview={preview} />
                </div>
              </Disclosure>
            )}
          </ReviewSection>
        </div>

        <ReviewChecklist
          items={items}
          isConfirmed={mapping.state === 'confirmed'}
          changed={changed}
          busy={busy}
          error={message}
          onApprove={handleApprove}
        />
      </div>

      <NewCustomerDialog
        open={newCustomerName !== null}
        defaults={{
          ...newCustomerDefaults(outputs),
          // A name searched for and not found beats the guess from the file.
          ...(newCustomerName ? { name: newCustomerName } : {}),
        }}
        customers={customers.data}
        unlinked={customers.unlinked}
        onCreated={handleCustomerCreated}
        onClose={() => setNewCustomerName(null)}
      />

      {/* A whole step back to the proposal can undo many edits at once, so it
          asks first; one field or code resets straight away. */}
      <ConfirmDialog
        open={confirmingReset !== null}
        title={confirmingReset === 'products' ? 'Reset the product codes?' : 'Reset the fields?'}
        description={
          confirmingReset === 'products'
            ? `${changedCodes.length} product code${changedCodes.length === 1 ? '' : 's'} go back to the master SKU the ${PROPOSER} proposed.`
            : `Every field in step 2 goes back to the ${PROPOSER}'s proposal, including the product codes in step 3. The customer and retailer in step 1 are kept.`
        }
        confirmLabel="Reset"
        tone="default"
        onConfirm={confirmReset}
        onCancel={() => setConfirmingReset(null)}
      />

      <ConfirmDiscardDialog
        mapping={isConfirmingDiscard ? mapping : null}
        isDiscarding={busy === 'discard'}
        onCancel={() => setIsConfirmingDiscard(false)}
        onConfirm={handleDiscard}
      />
    </div>
  );
}
