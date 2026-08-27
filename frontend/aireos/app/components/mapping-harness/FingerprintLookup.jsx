'use client';

import { useState } from 'react';
import StatusPill from './StatusPill';
import ContractView from './ContractView';

// Look up a stored mapping by fingerprint. Shows confirmed/pending state,
// timestamp, example file, and the contract — or an empty prompt / error.
export default function FingerprintLookup({ onLookup }) {
  const [fingerprint, setFingerprint] = useState('');
  const [lookedUpFingerprint, setLookedUpFingerprint] = useState('');
  const [result, setResult] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleLookup = async () => {
    const trimmed = fingerprint.trim();
    setResult(null);
    setError('');
    if (!trimmed) {
      setMessage('Enter a fingerprint.');
      return;
    }
    setMessage('');
    setBusy(true);
    try {
      const data = await onLookup(trimmed);
      setResult(data);
      setLookedUpFingerprint(trimmed);
    } catch (lookupError) {
      setError(lookupError.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mb-8 rounded-lg border border-lavander bg-white p-5 shadow-sm">
      <div className="mb-3">
        <h2 className="font-serif text-2xl text-deep-violet-blue">Look up by fingerprint</h2>
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <input
          type="text"
          value={fingerprint}
          onChange={(event) => setFingerprint(event.target.value)}
          placeholder="fingerprint"
          spellCheck={false}
          className="w-full rounded-md border border-lavander bg-cream px-3 py-2 font-mono text-sm text-deep-violet-blue focus:border-violet focus:outline-none md:w-64"
        />
        <button
          type="button"
          onClick={handleLookup}
          disabled={busy}
          className="rounded-md border border-deep-violet-blue bg-deep-violet-blue px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? 'Fetching…' : 'Fetch mapping'}
        </button>
      </div>

      {message && <p className="mt-3 text-sm text-deep-violet-blue/60">{message}</p>}
      {error && (
        <p className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 font-mono text-xs text-red-700">
          {error}
        </p>
      )}

      {result && (
        <div className="mt-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <StatusPill variant={result.state === 'confirmed' ? 'ok' : 'pending'}>
              {result.state}
            </StatusPill>
            <StatusPill variant="mute" mono>
              {lookedUpFingerprint}
            </StatusPill>
            {result.confirmed_at ? (
              <span className="text-xs text-deep-violet-blue/60">confirmed {result.confirmed_at}</span>
            ) : result.proposed_at ? (
              <span className="text-xs text-deep-violet-blue/60">proposed {result.proposed_at}</span>
            ) : null}
          </div>

          {result.example_file && (
            <dl className="mb-3 grid grid-cols-1 gap-x-3 gap-y-1 text-xs sm:grid-cols-[130px_1fr]">
              <dt className="font-mono uppercase tracking-wide text-deep-violet-blue/60">
                example file
              </dt>
              <dd className="break-all font-mono text-deep-violet-blue">{result.example_file}</dd>
            </dl>
          )}

          <ContractView contract={result.contract || {}} />
        </div>
      )}
    </section>
  );
}