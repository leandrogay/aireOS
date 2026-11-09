'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import ConfirmDialog from '@/components/ui/ConfirmDialog';
import useGuidedReview from '@/hooks/useGuidedReview';
import { canContinue, guidedSteps, nextStep, previousStep } from '@/app/utils/guidedSteps';
import { newCustomerDefaults } from '@/app/utils/mappingCustomer';

import ApprovedSummary from '../mappings/ApprovedSummary';
import ConfirmDiscardDialog from '../mappings/ConfirmDiscardDialog';
import FieldEditorDialog from '../mappings/FieldEditorDialog';
import NewCustomerDialog from '../mappings/NewCustomerDialog';
import ApproveStep from './ApproveStep';
import ChannelStep from './ChannelStep';
import CustomerPick from './CustomerPick';
import FieldsStep from './FieldsStep';
import GroupsStep from './GroupsStep';
import GuidedFrame, { StepRail } from './GuidedFrame';
import IntroStep from './IntroStep';
import MissingStep from './MissingStep';
import ProductsStep from './ProductsStep';
import RollupStep from './RollupStep';
import TestStep from './TestStep';

// One tip per screen, in the strip above its Back / Continue.
const TIPS = {
  intro: 'Nothing is saved until you approve on the last step, and you can go back at any time.',
  customer: 'Sales only reach the dashboard through the customer’s retailers, so pick the customer this file comes from.',
  channel: 'Anything not marked online goes to the offline retailer, including new values in next month’s file.',
  groups: 'Each of these columns becomes its own row, so a 12-month file gives 12 rows per product.',
  fields: 'A ticked field looks right to us. Untick one, or press Change, to read it from somewhere else.',
  missing: 'Every required field needs a source before you can approve.',
  rollup: 'Not sure? Keep the rows as they are. Weekly rows still show as months on the dashboard.',
  products: 'Every code must be one of our master SKUs. Codes you match here are remembered for next month’s file.',
  test: 'Testing reads the whole example file and saves nothing, so test as often as you like.',
  approve: 'Approving loads no sales yet. You’ll choose when to load the waiting files next.',
};

/**
 * The guided review of one mapping (/nomenclature/[id]): the same decisions
 * as the full review (/mappings/[id]), asked one topic per screen. Screens
 * this mapping has nothing to ask on are skipped; Continue opens once the
 * screen's question is answered; the last screen approves, and the finish
 * offers to load the files waiting on the nomenclature.
 *
 * @param {{
 *   mapping: object,
 *   mappingId: string,
 *   onApprove: (payload: object) => Promise<object>,
 *   onDiscard?: () => Promise<void>,
 *   onPreview: (payload: object) => Promise<object>,
 * }} props
 */
export default function GuidedReview({ mapping, mappingId, onApprove, onDiscard, onPreview }) {
  const router = useRouter();
  const review = useGuidedReview({ mapping, onApprove, onDiscard, onPreview });
  const { edits } = review;

  const [stepKey, setStepKey] = useState('intro');
  const [visited, setVisited] = useState(['intro']);
  // The field whose editor is open (its coverage entry), or null.
  const [editing, setEditing] = useState(null);
  // A whole screen's undo, waiting on "are you sure?": { kind: 'fields', fields } | { kind: 'products' } | null.
  const [confirmingReset, setConfirmingReset] = useState(null);
  const [isConfirmingDiscard, setIsConfirmingDiscard] = useState(false);
  const [isConfirmingLeave, setIsConfirmingLeave] = useState(false);

  const steps = guidedSteps(review.status, visited);
  const disabled = review.busy !== null;
  const isConfirmed = mapping.state === 'confirmed';
  const fullEditorHref = `/mappings/${encodeURIComponent(mappingId)}`;

  function goTo(key) {
    setVisited((prev) => (prev.includes(key) ? prev : [...prev, key]));
    setStepKey(key);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // The full editor starts from what is saved, so edits made here would be
  // lost on the way; ask first when there are any.
  function openFullEditor() {
    if (review.changed) setIsConfirmingLeave(true);
    else router.push(fullEditorHref);
  }

  function confirmReset() {
    if (confirmingReset?.kind === 'fields') edits.resetFields(confirmingReset.fields);
    if (confirmingReset?.kind === 'products') edits.resetSkuCodes(review.changedCodes);
    setConfirmingReset(null);
  }

  async function confirmDiscard() {
    const discarded = await review.discard();
    if (!discarded) setIsConfirmingDiscard(false);
  }

  if (review.approved) {
    return (
      <div className="grid gap-3 lg:grid-cols-[14rem_minmax(0,1fr)] lg:items-start">
        <div className="hidden lg:block">
          <StepRail steps={steps} stepKey={null} visited={visited} finished />
        </div>
        <ApprovedSummary approved={review.approved} />
      </div>
    );
  }

  const previous = previousStep(stepKey, steps);
  const next = nextStep(stepKey, steps);
  const allDone = review.items.every((item) => item.done);

  let primary;
  if (stepKey === 'approve') {
    primary = {
      label: review.busy === 'approve' ? 'Saving…' : isConfirmed ? 'Save new version' : 'Approve nomenclature',
      onClick: review.approve,
      disabled: !allDone || (isConfirmed && !review.changed) || disabled,
      busy: review.busy === 'approve',
      note:
        isConfirmed && !review.changed ? (
          <p className="text-sm text-deep-violet-blue/80">Nothing has changed, so there is nothing to save.</p>
        ) : null,
    };
  } else {
    primary = {
      label: stepKey === 'intro' ? 'Let’s start' : 'Continue',
      onClick: () => next && goTo(next),
      disabled: !next || !canContinue(stepKey, review.status) || disabled,
    };
  }

  const subtitles = {
    intro: isConfirmed
      ? 'You’re changing a live nomenclature. Here is the file it was made from.'
      : 'The AI read your file and proposed how to import it. Check it with us, one step at a time.',
    customer: 'Pick the customer this file belongs to.',
    channel: 'Choose whether the rows are online sales, offline sales, or a mix.',
    groups: 'Your file has a column for each period or outlet. Check how we turn them into rows.',
    fields: 'Where each piece of the sales data comes from in your file.',
    missing: 'These are required, and nothing in the file fills them yet.',
    rollup: 'How the rows load into the sales data.',
    products: 'Match each code in the file to one of our products.',
    test: 'We’ll run your answers over the whole file and check the totals add up.',
    approve: 'Give the nomenclature a name you’ll recognise, then approve it.',
  };

  let body;
  switch (stepKey) {
    case 'intro':
      body = (
        <IntroStep
          mapping={mapping}
          layout={review.layout}
          headRows={review.headRows}
          codeCount={review.codes.length}
          canDiscard={review.canDiscard}
          onDiscard={() => setIsConfirmingDiscard(true)}
          disabled={disabled}
        />
      );
      break;
    case 'customer':
      body = (
        <CustomerPick
          customers={review.customers.data}
          loading={review.customers.loading}
          error={review.customers.error}
          customer={review.customer}
          suggested={review.customerSuggested}
          legacyVendor={!mapping.customerId && isConfirmed ? mapping.vendor : null}
          onChoose={review.chooseCustomer}
          onNewCustomer={review.setNewCustomerName}
          disabled={disabled}
        />
      );
      break;
    case 'channel':
      body = <ChannelStep review={review} mapping={mapping} disabled={disabled} />;
      break;
    case 'groups':
      body = <GroupsStep review={review} mapping={mapping} onEdit={setEditing} disabled={disabled} />;
      break;
    case 'fields':
      body = (
        <FieldsStep
          review={review}
          mapping={mapping}
          onEdit={setEditing}
          onResetStep={(fields) => setConfirmingReset({ kind: 'fields', fields })}
          disabled={disabled}
        />
      );
      break;
    case 'missing':
      body = <MissingStep review={review} onEdit={setEditing} disabled={disabled} />;
      break;
    case 'rollup':
      body = <RollupStep review={review} disabled={disabled} />;
      break;
    case 'products':
      body = (
        <ProductsStep
          review={review}
          mapping={mapping}
          onResetStep={() => setConfirmingReset({ kind: 'products' })}
          disabled={disabled}
        />
      );
      break;
    case 'test':
      body = <TestStep review={review} steps={steps} onGoTo={goTo} disabled={disabled} />;
      break;
    default:
      body = (
        <ApproveStep
          review={review}
          mapping={mapping}
          steps={steps}
          onGoTo={goTo}
          onEdit={setEditing}
          onDiscard={() => setIsConfirmingDiscard(true)}
          disabled={disabled}
        />
      );
  }

  return (
    <>
      <GuidedFrame
        steps={steps}
        stepKey={stepKey}
        visited={visited}
        onGoTo={goTo}
        subtitle={subtitles[stepKey]}
        tip={TIPS[stepKey]}
        onBack={previous ? () => goTo(previous) : undefined}
        onFullEditor={openFullEditor}
        primary={primary}
      >
        {review.discardError && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {review.discardError}
          </p>
        )}
        {/* Keyed by screen, so a screen's fixed order (fields, codes) is
            worked out afresh each time it is opened. */}
        <div key={stepKey} className="flex flex-col gap-4">
          {body}
        </div>
      </GuidedFrame>

      <NewCustomerDialog
        open={review.newCustomerName !== null}
        defaults={{
          ...newCustomerDefaults(review.outputs),
          // A name searched for and not found beats the guess from the file.
          ...(review.newCustomerName ? { name: review.newCustomerName } : {}),
        }}
        customers={review.customers.data}
        unlinked={review.customers.unlinked}
        onCreated={review.handleCustomerCreated}
        onClose={() => review.setNewCustomerName(null)}
      />

      <FieldEditorDialog
        entry={editing}
        mapping={mapping}
        state={edits.state}
        layout={review.layout}
        onApply={(field, decision) => {
          edits.setFieldDecision(field, decision);
          setEditing(null);
        }}
        onClose={() => setEditing(null)}
      />

      <ConfirmDialog
        open={confirmingReset !== null}
        title={confirmingReset?.kind === 'products' ? 'Undo your product-code changes?' : 'Undo your changes on this screen?'}
        description={
          confirmingReset?.kind === 'products'
            ? `${review.changedCodes.length} product code${review.changedCodes.length === 1 ? '' : 's'} go back to the master SKU the AI proposed.`
            : 'Every field on this screen goes back to the AI’s proposal, including the product codes. The customer and retailer are kept.'
        }
        confirmLabel="Undo changes"
        tone="default"
        onConfirm={confirmReset}
        onCancel={() => setConfirmingReset(null)}
      />

      <ConfirmDialog
        open={isConfirmingLeave}
        title="Leave the guided review?"
        description="The full editor opens the nomenclature as it is saved, so the changes you made here will be lost."
        confirmLabel="Open full editor"
        tone="default"
        onConfirm={() => router.push(fullEditorHref)}
        onCancel={() => setIsConfirmingLeave(false)}
      />

      <ConfirmDiscardDialog
        mapping={isConfirmingDiscard ? mapping : null}
        isDiscarding={review.busy === 'discard'}
        onCancel={() => setIsConfirmingDiscard(false)}
        onConfirm={confirmDiscard}
      />
    </>
  );
}
