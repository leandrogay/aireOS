'use client';

import { useEffect, useState } from 'react';

import useCustomers from '@/hooks/useCustomers';
import useMappingEdits from '@/hooks/useMappingEdits';
import { createRetailer, linkRetailer } from '@/app/services/catalogApi';
import { currentDecision } from '@/app/utils/fieldDecision';
import { checkSummary } from '@/app/utils/mappingChecks';
import { retailerDecision, retailerOutputs, retailerStatuses, suggestCustomerId } from '@/app/utils/mappingCustomer';
import { reviewIssues } from '@/app/utils/mappingReview';
import { reviewChecklist } from '@/app/utils/reviewChecklist';
import { codeRows, unknownCodes } from '@/app/utils/skuCodeTable';

/**
 * Everything the guided review (/nomenclature/[id]) needs to know and do
 * about one mapping: the reviewer's edits (useMappingEdits), the customer and
 * its retailers, the product codes, the checks and their freshness, the
 * "What's left" list, and the approve / discard / test calls.
 *
 * The same rules as the full review (components/mappings/MappingReviewPanel),
 * kept apart while the guided version is on trial so the full page is not
 * touched; if the guided version stays, the panel can move onto this hook.
 *
 * @param {{
 *   mapping: object,
 *   onApprove: (payload: object) => Promise<object>,
 *   onDiscard?: () => Promise<void>,
 *   onPreview: (payload: object) => Promise<object>,
 * }} options
 */
export default function useGuidedReview({ mapping, onApprove, onDiscard, onPreview }) {
  const edits = useMappingEdits({ mapping });
  const customers = useCustomers();
  const [name, setName] = useState(mapping.name || '');
  // null until the customers load; then the reviewer's pick, or a suggestion.
  const [customerChoice, setCustomerChoice] = useState(null);
  // The new-customer form, open with a name to start from, or null while closed.
  const [newCustomerName, setNewCustomerName] = useState(null);
  const [busy, setBusy] = useState(null); // null | 'approve' | 'discard' | 'preview'
  const [message, setMessage] = useState('');
  const [approved, setApproved] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState('');
  const [discardError, setDiscardError] = useState('');

  const decision = retailerDecision(mapping, edits.rows, edits.fieldEdits, edits.groups);
  const outputs = retailerOutputs(decision);

  // The starting customer is settled once, when the list arrives: the one the
  // mapping was saved under, else one its retailers point at. Set during
  // render (the one-time-default case) so no screen shows a blank customer it
  // is about to fill in.
  if (!customerChoice && !customers.loading) {
    const suggestion = suggestCustomerId(mapping, customers.data, outputs);
    setCustomerChoice({ id: suggestion, suggested: Boolean(suggestion) && !mapping.customerId });
  }
  const customer = customers.data.find((item) => item.customer_id === customerChoice?.id) || null;
  const statuses = retailerStatuses(outputs, customer, customers.data, customers.unlinked);

  const issues = reviewIssues(mapping, edits.state);

  // The product-code table lives on the sku field's transforms. Codes come
  // from the latest run when there is one (the sku may have been repointed).
  const skuField = edits.rows.flatMap((row) => row.fields).find((field) => field.targetField === 'sku');
  const masterAvailable = mapping.masterSkusAvailable !== false;
  const codes = skuField ? codeRows(preview?.sku_codes || mapping.skuCodes, skuField.transform, mapping.masterSkus) : [];
  const unknown = masterAvailable ? unknownCodes(codes) : [];
  const changedCodes = codes.map((row) => row.code).filter(edits.codeChanged);

  // Checks are the proposal's until the reviewer runs them, and go stale the
  // moment the rules differ from the ones they ran on.
  const rulesKey = JSON.stringify({ rules: edits.rules, instructions: edits.instructionsPayload });
  const checks = preview ? preview.checks : mapping.checks;
  const stale = preview ? preview.rulesKey !== rulesKey : edits.changed;
  const failed = checkSummary(checks).failed;

  // Where the data sits in the example file, as last read.
  const layout = preview?.layout || mapping.layout || {};
  const headRows = preview?.head_rows?.length ? preview.head_rows : mapping.headRows || [];

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

  // A file that is plainly monthly (period type always "month") and does not
  // roll up has nothing to ask about weeks and months.
  const periodType = currentDecision(mapping, edits.state, 'period_type');
  const plainlyMonthly = periodType.method === 'constant' && periodType.value === 'month';
  const rollupRelevant = edits.instructions.aggregate || !plainlyMonthly;

  // What the step logic (utils/guidedSteps) reads.
  const status = {
    hasCustomer: Boolean(customer),
    retailersDone: Boolean(items.find((item) => item.id === 'retailers')?.done),
    retailerUnconfirmed: issues.unconfirmed.some((entry) => entry.field === 'retailer'),
    groupCount: edits.groups.length + issues.unusedGroups.length,
    unconfirmedGroups: issues.unconfirmed.filter((entry) => entry.groupId).length,
    unconfirmedFields: issues.unconfirmed.filter((entry) => entry.field !== 'retailer').length,
    duplicateCount: issues.duplicateTargets.length,
    missingCount: issues.missingRequired.length,
    rollupRelevant,
    codeCount: codes.length,
    unknownCodeCount: unknown.length,
    masterAvailable,
    checksFailed: failed,
    checksStale: stale,
  };

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

  function chooseCustomer(id) {
    setCustomerChoice({ id, suggested: false });
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
      setPreview({ ...(await onPreview({ rules: edits.rules, instructions: edits.instructionsPayload })), rulesKey });
    } catch (error) {
      setPreview(null);
      setPreviewError(error.message);
    } finally {
      setBusy(null);
    }
  }

  async function approve() {
    setBusy('approve');
    setMessage('');
    try {
      setApproved(
        await onApprove({
          rules: edits.rules,
          instructions: edits.instructionsPayload,
          name: name.trim(),
          customer_id: customer.customer_id,
        }),
      );
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(null);
    }
  }

  // On success the page navigates away; on failure the error is returned so
  // the screen that asked can say it.
  async function discard() {
    setBusy('discard');
    setDiscardError('');
    try {
      await onDiscard();
      return true;
    } catch (error) {
      setDiscardError(error.message);
      return false;
    } finally {
      setBusy(null);
    }
  }

  return {
    edits,
    customers,
    name,
    setName,
    customer,
    customerSuggested: Boolean(customerChoice?.suggested),
    chooseCustomer,
    newCustomerName,
    setNewCustomerName,
    handleCustomerCreated,
    decision,
    outputs,
    statuses,
    fixRetailer,
    issues,
    codes,
    unknown,
    changedCodes,
    masterAvailable,
    checks,
    stale,
    failed,
    preview,
    previewError,
    runChecks,
    layout,
    headRows,
    changed,
    items,
    status,
    busy,
    message,
    approved,
    approve,
    canDiscard: Boolean(onDiscard) && mapping.state === 'pending',
    discard,
    discardError,
  };
}
