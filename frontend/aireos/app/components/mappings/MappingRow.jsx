'use client';

import { ChevronRight, Trash2 } from 'lucide-react';

import RowActions from '@/components/ui/RowActions';
import StatusPill from '@/components/ui/StatusPill';
import TableRow from '@/components/ui/TableRow';
import { formatDate } from '@/lib/formatDate';
import {
  mappingCustomer,
  mappingSourceLine,
  mappingStatus,
  mappingTitle,
} from '@/app/utils/mappingList';

// mappingStatus() kinds → StatusPill tones.
const STATUS_TONES = {
  confirmed: 'success',
  unused: 'muted',
  pending: 'warning',
  missing: 'danger',
  warnings: 'warning',
  unknown: 'muted',
};

/**
 * One stored mapping as a table row. Clicking the row opens it for review;
 * the name button and action menu provide keyboard access.
 *
 * @param {{ mapping: object, onOpen: (mappingId: string) => void, onDelete: (mapping: object) => void }} props
 */
export function mappingRowActions(mapping, onOpen, onDelete) {
  return [
    { key: 'open', label: 'Open nomenclature', icon: ChevronRight, onSelect: () => onOpen(mapping.mappingId) },
    { key: 'delete', label: 'Delete nomenclature', icon: Trash2, onSelect: () => onDelete(mapping), destructive: true },
  ];
}

export default function MappingRow({ mapping, onOpen, onDelete }) {
  const status = mappingStatus(mapping);
  const sourceLine = mappingSourceLine(mapping);
  const customer = mappingCustomer(mapping);

  return (
    <TableRow
      onClick={() => onOpen(mapping.mappingId)}
      className="group h-14 cursor-pointer border-b border-lavander/80 bg-white transition-colors focus-within:bg-cream/50 hover:bg-cream/50"
    >
      <td className="px-4 py-2.5">
        <button
          type="button"
          onClick={(event) => {
            // The row's own onClick opens too; one open per click.
            event.stopPropagation();
            onOpen(mapping.mappingId);
          }}
          className="block max-w-full truncate rounded-md text-left font-medium underline-offset-2 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          title={mappingTitle(mapping)}
        >
          {mappingTitle(mapping)}
        </button>
        {sourceLine && (
          <p className="truncate text-xs text-deep-violet-blue/60" title={mapping.filename || sourceLine}>
            {sourceLine}
          </p>
        )}
      </td>
      <td className="truncate px-4 py-2.5" title={customer || undefined}>
        {customer || '—'}
        {/* Approved before customers existed: its sales may sit on retailers
            no customer owns. Linked on its next save. */}
        {mapping.state === 'confirmed' && !mapping.customerId && (
          <span className="ml-1.5 text-xs text-amber-900">(not linked)</span>
        )}
      </td>
      <td className="px-4 py-2.5">
        <StatusPill tone={STATUS_TONES[status.kind]}>{status.label}</StatusPill>
        {status.detail && <p className="mt-0.5 truncate text-xs text-amber-900">{status.detail}</p>}
      </td>
      <td className="px-4 py-2.5">{mapping.validatedAt ? formatDate(mapping.validatedAt) : '—'}</td>
      <td className="px-2 py-2.5">
        <div onClick={(event) => event.stopPropagation()}>
          <RowActions
            label={`Actions for nomenclature ${mappingTitle(mapping)}`}
            actions={mappingRowActions(mapping, onOpen, onDelete)}
          />
        </div>
      </td>
    </TableRow>
  );
}
