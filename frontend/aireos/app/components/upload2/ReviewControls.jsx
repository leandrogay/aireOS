'use client';

import { useState } from 'react';
import StatusPill from './StatusPill';
import ContractView from './ContractView';

// Approve / Edit JSON / Discard controls for a pending mapping.
// - Approve sends the contract as-is, or an edited version if the JSON changed.
// - Edit toggles a JSON editor (identity_mapping + melt_groups) with local
//   validation before anything is sent.
// - Discard deletes the pending proposal.
// On success the buttons are replaced by the outcome, matching the harness.
export default function ReviewControls({ fingerprint, contract, onConfirm, onDiscard }) {
  const initialJson = JSON.stringify(
    {
      identity_mapping: contract.identity_mapping || {},
      melt_groups: contract.melt_groups || [],
    },
    null,
    2,
  );

  const [showEditor, setShowEditor] = useState(false);
  const [editorValue, setEditorValue] = useState(initialJson);
  const [edited, setEdited] = useState(false);
  const [busyAction, setBusyAction] = useState(null); // null | 'approve' | 'discard'
  const [error, setError] = useState('');
  const [outcome, setOutcome] = useState(null); // null | { kind:'confirmed', storedAt, contract } | { kind:'discarded' }

  const busy = busyAction !== null;

  const handleEditorChange = (event) => {
    setEditorValue(event.target.value);
    setEdited(true);
  };

  // Only send { contract } when the JSON was edited; validate before sending.
  const handleApprove = async () => {
    let body = {};
    if (edited) {
      try {
        body = { contract: JSON.parse(editorValue) };
      } catch (parseError) {
        setError(`Edited JSON is not valid: ${parseError.message}`);
        return;
      }
    }

    setError('');
    setBusyAction('approve');
    try {
      const response = await onConfirm(fingerprint, body);
      setOutcome({
        kind: 'confirmed',
        storedAt: response?.stored_at || '',
        contract: response?.contract || {},
      });
    } catch (confirmError) {
      setError(confirmError.message);
    } finally {
      setBusyAction(null);
    }
  };

  const handleDiscard = async () => {
    setError('');
    setBusyAction('discard');
    try {
      await onDiscard(fingerprint);
      setOutcome({ kind: 'discarded' });
    } catch (discardError) {
      setError(discardError.message);
    } finally {
      setBusyAction(null);
    }
  };

  if (outcome?.kind === 'confirmed') {
    return (
      <div className="mt-3.5 border-t border-lavander pt-3">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <StatusPill variant="ok">confirmed</StatusPill>
          {outcome.storedAt && (
            <span className="text-xs text-deep-violet-blue/60">{outcome.storedAt}</span>
          )}
        </div>
        <ContractView contract={outcome.contract} />
      </div>
    );
  }

  if (outcome?.kind === 'discarded') {
    return (
      <div className="mt-3.5 border-t border-lavander pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill variant="mute">discarded</StatusPill>
          <span className="text-xs text-deep-violet-blue/60">
            The next upload of this layout will generate a fresh contract.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3.5 border-t border-lavander pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleApprove}
          disabled={busy}
          className="rounded-md border border-deep-violet-blue bg-deep-violet-blue px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busyAction === 'approve' ? 'Approving…' : 'Approve mapping'}
        </button>
        <button
          type="button"
          onClick={() => setShowEditor((open) => !open)}
          disabled={busy}
          className="rounded-md border border-lavander bg-white px-4 py-2 text-sm font-medium text-deep-violet-blue transition hover:bg-cream disabled:cursor-not-allowed disabled:opacity-60"
        >
          {showEditor ? 'Hide JSON' : 'Edit JSON'}
        </button>
        <button
          type="button"
          onClick={handleDiscard}
          disabled={busy}
          className="rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Discard proposal
        </button>
        <span className="text-xs text-deep-violet-blue/60">
          Approving stores it at{' '}
          <span className="font-mono">mappings/confirmed/{fingerprint}.json</span>
        </span>
      </div>

      {showEditor && (
        <textarea
          value={editorValue}
          onChange={handleEditorChange}
          spellCheck={false}
          className="mt-3 min-h-[240px] w-full resize-y rounded-md border border-lavander bg-cream/40 p-2.5 font-mono text-xs leading-relaxed text-deep-violet-blue"
        />
      )}

      {error && (
        <p className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 font-mono text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}