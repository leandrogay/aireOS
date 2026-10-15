import StatusPill from '@/components/ui/StatusPill';

/**
 * "In use" once a customer or retailer has data (it can then no longer be
 * renamed or deleted), "Unused" before.
 *
 * @param {{ inUse: boolean }} props
 */
export default function UsageStatus({ inUse }) {
  return <StatusPill tone={inUse ? 'success' : 'muted'}>{inUse ? 'In use' : 'Unused'}</StatusPill>;
}
