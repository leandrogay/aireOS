'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

import StatusPill from '@/components/ui/StatusPill';
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
  pending: 'warning',
  missing: 'danger',
  warnings: 'warning',
  unknown: 'muted',
};

/**
 * One stored mapping as a table row. Clicking anywhere on the row opens it
 * for review; the name button is the keyboard route to the same action.
 *
 * @param {{ mapping: object, onOpen: (mappingId: string) => void }} props
 */
export default function MappingRow({ mapping, onOpen }) {
  const status = mappingStatus(mapping);
  const sourceLine = mappingSourceLine(mapping);
  const customer = mappingCustomer(mapping);

  return (
    <tr
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
        <p className="flex min-w-0 items-center gap-2 text-xs text-deep-violet-blue/80">
          {sourceLine && (
            <span className="truncate" title={mapping.filename || sourceLine}>
              {sourceLine}
            </span>
          )}
          {/* The guided review is on trial beside the full one
              (app/nomenclature/[id]); its own click, not the row's. */}
          <Link
            href={`/nomenclature/${encodeURIComponent(mapping.mappingId)}`}
            onClick={(event) => event.stopPropagation()}
            className="shrink-0 rounded-full border border-violet/60 bg-lavander/60 px-1.5 py-px text-[11px] font-medium text-deep-violet-blue outline-none hover:bg-lavander focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Guided review (dev)
          </Link>
        </p>
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
        <ChevronRight
          aria-hidden="true"
          className="size-4 text-deep-violet-blue/30 transition-colors group-focus-within:text-deep-violet-blue group-hover:text-deep-violet-blue"
        />
      </td>
    </tr>
  );
}
