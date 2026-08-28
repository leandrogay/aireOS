import StatusPill from './StatusPill';
import ContractView from './ContractView';
import ReviewControls from './ReviewControls';

// Maps mapping.status to the top status pill.
const STATUS_PILL = {
  mapped: { variant: 'ok', label: 'mapped from cache' },
  pending_confirmation: { variant: 'pending', label: 'awaiting your approval' },
  mapping_failed: { variant: 'bad', label: 'mapping failed' },
};

// A file's mapping: status pill + fingerprint + source, then either the failure
// reason or the contract. Pending contracts also get review controls.
export default function MappingSection({ mapping, onConfirm, onDiscard }) {
  const status = STATUS_PILL[mapping.status] || STATUS_PILL.mapping_failed;

  return (
    <div className="mt-1">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <StatusPill variant={status.variant}>{status.label}</StatusPill>
        {mapping.fingerprint && (
          <StatusPill variant="mute" mono>
            {mapping.fingerprint}
          </StatusPill>
        )}
        {mapping.source && (
          <span className="text-xs text-deep-violet-blue/60">source: {mapping.source}</span>
        )}
      </div>

      {mapping.status === 'mapping_failed' ? (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 font-mono text-xs text-red-700">
          {(mapping.reason || 'error') + ' — ' + (mapping.error || '')}
        </p>
      ) : (
        <>
          <ContractView contract={mapping.contract || {}} />
          {mapping.status === 'pending_confirmation' && (
            <ReviewControls
              fingerprint={mapping.fingerprint}
              contract={mapping.contract || {}}
              onConfirm={onConfirm}
              onDiscard={onDiscard}
            />
          )}
        </>
      )}
    </div>
  );
}