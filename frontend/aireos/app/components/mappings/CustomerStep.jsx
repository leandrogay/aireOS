'use client';

import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import InfoTooltip from '@/components/ui/InfoTooltip';
import SelectDropdown from '@/components/ui/SelectDropdown';
import { inputClass, labelClass } from '@/components/inventory/formStyles';
import { canRenameOutputs, retailerChoices } from '@/app/utils/mappingCustomer';
import { PROPOSER } from '@/app/utils/mappingReview';
import { retailerLabel } from '@/app/utils/retailerLabel';
import { cn } from '@/lib/utils';

import ChannelSplit from './ChannelSplit';
import ResetButton from './ResetButton';

const smallButton = 'h-7 border-deep-violet-blue/30 bg-white px-2 text-xs text-deep-violet-blue hover:bg-cream';

// What is wrong with a retailer, in a few words. A retailer that is fine says
// nothing: its tick is enough.
const STATUS_TEXT = {
  ok: () => '',
  new: () => 'New retailer',
  unlinked: () => 'Not linked to a customer',
  other: (item) => `Belongs to ${retailerLabel(item.owner)}`,
  invalid: () => 'Not a retailer name',
};

/**
 * One retailer the mapping writes to, whether it is the customer's, and the
 * one-click fix when it is not: add it to the customer, or link the one an
 * upload already made.
 *
 * With a `choice` the line is one rule, code or default of the mapping --
 * "is “FPON” → fairprice_online" -- and its retailer is a dropdown that always
 * shows what it writes now, so a change can always be changed back.
 */
function RetailerLine({ item, choice, customerName, retailers, onChoose, onFix, disabled }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const customer = retailerLabel(customerName);
  const status = item.status;
  const ok = !status || status === 'ok';
  const known = retailers.some((retailer) => retailer.retailer_name === item.name);

  async function fix() {
    setBusy(true);
    setError('');
    try {
      await onFix(item);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={cn('rounded-md px-2 py-1', !ok && 'border border-amber-300 bg-amber-50')}>
      <div className="flex flex-wrap items-center gap-2">
        {status === 'ok' && (
          <CheckCircle2 aria-label="One of the customer's retailers" className="size-3.5 shrink-0 text-green-700" />
        )}
        {!ok && <AlertTriangle aria-hidden="true" className="size-3.5 shrink-0 text-amber-700" />}

        {choice ? (
          <>
            <span className="text-xs text-deep-violet-blue/70">{choice.when}</span>
            <span aria-hidden="true" className="text-xs text-deep-violet-blue/40">
              →
            </span>
            {/* What it writes now stays a choice even when it is not one of
                the customer's, so the dropdown never loses it. */}
            <SelectDropdown
              value={item.name}
              onChange={(retailerName) => onChoose(choice.key, retailerName)}
              size="sm"
              ariaLabel={`Retailer for rows where ${choice.when}`}
              disabled={disabled || !customerName}
              className="w-auto"
              triggerClassName="font-mono"
              options={[
                ...(known ? [] : [{ value: item.name, label: item.name, hint: 'not this customer’s' }]),
                ...retailers.map((retailer) => ({ value: retailer.retailer_name, label: retailer.retailer_name })),
              ]}
            />
          </>
        ) : (
          <span className="font-mono text-xs text-deep-violet-blue">{item.name}</span>
        )}
        {!ok && <span className="text-[11px] text-amber-900">{STATUS_TEXT[status](item)}</span>}

        {(status === 'new' || status === 'unlinked') && (
          <Button type="button" variant="outline" disabled={disabled || busy} onClick={fix} className={cn(smallButton, 'ml-auto')}>
            {busy ? <Loader2 aria-hidden="true" className="size-3 animate-spin" /> : <Plus aria-hidden="true" className="size-3" />}
            {status === 'new' ? `Add to ${customer}` : `Link to ${customer}`}
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-1 text-[11px] text-red-700">
          {error}
        </p>
      )}
    </li>
  );
}

/**
 * Where the retailer comes from, in a few words, and the longer explanation
 * for the info icon beside it.
 */
function decisionText(decision, outputs) {
  if (decision.kind === 'none' || decision.status === 'not_available' || decision.status === 'unmapped') {
    return {
      short: 'Not set',
      long: 'Nothing in this mapping sets the retailer. Send every row to one of the customer’s retailers, or choose a column for Retailer in step 2.',
    };
  }
  if (decision.status === 'constant') {
    return { short: 'One retailer for every row', long: 'Every row of the file is written to the same retailer.' };
  }
  const from =
    decision.kind === 'column'
      ? `column “${decision.column}”`
      : decision.kind === 'headings'
        ? 'the column headings'
        : 'another field';
  if (!outputs) {
    return {
      short: `From ${from}`,
      long: 'Worked out in a way that can only be checked against the whole file, which happens when you approve.',
    };
  }
  if (!canRenameOutputs(decision)) {
    return { short: `From ${from}, as it is`, long: 'Read as it is from the column. These are its values in the example rows.' };
  }
  return { short: `From ${from}`, long: 'Worked out from the column. These are the retailers the rows are written to.' };
}

/**
 * Step 1: what the mapping is called, which customer's files it reads, and
 * whether the retailers its rows are written to are that customer's.
 *
 * @param {{
 *   name: string,
 *   onNameChange: (name: string) => void,
 *   customers: object[],
 *   customersLoading: boolean,
 *   customersError: string | null,
 *   customer: object | null,
 *   suggested: boolean,
 *   legacyVendor: string | null,
 *   onCustomerChange: (customerId: number | null) => void,
 *   onNewCustomer: (name: string) => void,
 *   decision: object,
 *   outputs: string[] | null,
 *   statuses: object[],
 *   onFixRetailer: (item: object) => Promise<void>,
 *   onSetRetailerChoice: (key: string, retailerName: string) => void,
 *   onApplyRetailer: (decision: object) => void,
 *   mapping: object,
 *   state: object,
 *   layout: object,
 *   retailerChanged: boolean,
 *   onResetRetailer: () => void,
 *   disabled: boolean,
 * }} props
 */
export default function CustomerStep({
  name,
  onNameChange,
  customers,
  customersLoading,
  customersError,
  customer,
  suggested,
  legacyVendor,
  onCustomerChange,
  onNewCustomer,
  decision,
  outputs,
  statuses,
  onFixRetailer,
  onSetRetailerChoice,
  onApplyRetailer,
  mapping,
  state,
  layout,
  retailerChanged,
  onResetRetailer,
  disabled,
}) {
  const retailers = customer?.retailers || [];
  // One line per rule, code or constant, when the mapping writes the retailer
  // that way; otherwise one line per retailer it writes (a column read as it is).
  const choices = canRenameOutputs(decision) ? retailerChoices(decision) : [];
  const statusOf = (retailerName) =>
    statuses.find((item) => item.name === retailerName) || { name: retailerName, status: null };
  const where = decisionText(decision, outputs);

  // Said under the customer only when there is something to say.
  let customerNote = '';
  if (suggested) customerNote = legacyVendor ? `Matched to its old vendor “${legacyVendor}”` : 'Suggested from the file';
  else if (legacyVendor && !customer) customerNote = `Saved as “${legacyVendor}” before customers existed — choose one`;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="mapping-name" className={labelClass}>
            Mapping name
            <span className="text-red-700" aria-hidden="true">
              {' '}
              *
            </span>
          </label>
          <input
            id="mapping-name"
            type="text"
            value={name}
            maxLength={120}
            required
            disabled={disabled}
            onChange={(event) => onNameChange(event.target.value)}
            placeholder="e.g. Fairprice Monthly sell-out"
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="mapping-customer" className={labelClass}>
            Customer
            <span className="text-red-700" aria-hidden="true">
              {' '}
              *
            </span>
          </label>
          {/* Look for the customer first; creating one is the last row of
              the same list, carrying over a name searched for and not found. */}
          <SelectDropdown
            id="mapping-customer"
            value={customer ? String(customer.customer_id) : ''}
            onChange={(id) => onCustomerChange(id ? Number(id) : null)}
            placeholder={customersLoading ? 'Loading customers…' : 'Choose a customer…'}
            searchable={customers.length > 8}
            searchPlaceholder="Search customers…"
            disabled={disabled || customersLoading}
            options={customers.map((item) => ({
              value: String(item.customer_id),
              label: retailerLabel(item.customer_name),
            }))}
            action={{
              label: (typed) => (typed ? `Create customer “${typed}”` : 'Create new customer'),
              onSelect: onNewCustomer,
            }}
          />
          {customersError && (
            <p role="alert" className="mt-1 text-xs text-red-700">
              Customers could not be loaded: {customersError}
            </p>
          )}
          {!customersError && customerNote && (
            <p className="mt-1 text-[11px] text-deep-violet-blue/60">{customerNote}</p>
          )}
        </div>
      </div>

      <div>
        <div className="flex items-center gap-1 text-xs text-deep-violet-blue">
          <span className="font-medium">Sales go to:</span>
          <span className="text-deep-violet-blue/70">{where.short}</span>
          <InfoTooltip label="Where the sales go">
            {where.long} Sales only reach the dashboard through the customer&apos;s retailers.
          </InfoTooltip>
          {retailerChanged && (
            <ResetButton
              label={`Reset the retailer to the ${PROPOSER}'s proposal`}
              onClick={onResetRetailer}
              disabled={disabled}
              className="ml-auto"
            />
          )}
        </div>

        {choices.length > 0 && (
          <ul className="mt-1 space-y-1">
            {choices.map((choice) => (
              <RetailerLine
                key={choice.key}
                item={customer ? statusOf(choice.output) : { name: choice.output, status: null }}
                choice={choice}
                customerName={customer?.customer_name}
                retailers={retailers}
                onChoose={onSetRetailerChoice}
                onFix={onFixRetailer}
                disabled={disabled}
              />
            ))}
          </ul>
        )}

        {!customer && outputs?.length > 0 && !choices.length && (
          <p className="mt-1 text-xs text-deep-violet-blue/70">
            <span className="font-mono">{outputs.join(', ')}</span> · choose the customer to check these
          </p>
        )}

        {customer && !choices.length && statuses.length > 0 && (
          <ul className="mt-1 space-y-1">
            {statuses.map((item) => (
              <RetailerLine
                key={item.name}
                item={item}
                customerName={customer.customer_name}
                retailers={retailers}
                onFix={onFixRetailer}
                disabled={disabled}
              />
            ))}
          </ul>
        )}

        {customer && !retailers.length && (
          <p className="mt-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900">
            {retailerLabel(customer.customer_name)} has no retailers yet. Choose how rows split below, then add the
            retailers it needs.
          </p>
        )}

        {customer && (
          <div className="mt-2">
            {/* Remounted when the decision or customer changes, so it starts
                from what the mapping does now. */}
            <ChannelSplit
              key={`${customer.customer_id}:${JSON.stringify(decision.transforms)}:${decision.value ?? ''}:${decision.kind}`}
              customer={customer}
              decision={decision}
              outputs={outputs}
              mapping={mapping}
              state={state}
              layout={layout}
              onApply={onApplyRetailer}
              disabled={disabled}
            />
          </div>
        )}
      </div>
    </div>
  );
}
