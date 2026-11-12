'use client';

import { ChevronDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import TableGrid from '@/components/ui/TableGrid';
import TableRow from '@/components/ui/TableRow';
import { yearContributions } from '@/app/utils/scenarioTableView';

const COLUMNS = [{ key: 'part', label: 'Contribution' }, { key: 'units', label: 'Units', width: '7rem' }];

function signed(value) {
  return `${value < 0 ? '−' : '+'}${Math.round(Math.abs(value)).toLocaleString('en-US')}`;
}

/** @param {{ row: object }} props Yearly change with its contributions available on demand. */
export default function YearChangeDetails({ row }) {
  const parts = yearContributions(row.parts);
  if (!parts.length) return signed(row.delta);
  return (
    <Popover>
      <PopoverTrigger aria-label={`View contributions for ${row.label}`}
        className="inline-flex items-center gap-1 rounded-sm font-semibold text-scenario-ink underline decoration-dotted underline-offset-4">
        {signed(row.delta)}<ChevronDown className="size-3" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 max-w-[90vw] gap-2 p-3">
        <h3 className="text-sm font-semibold">{row.label} · change by contribution</h3>
        <TableGrid variant="nested" columns={COLUMNS}>
          {parts.map((part) => (
            <TableRow key={part.key}>
              <td className="whitespace-normal px-3 py-2 text-xs">{part.label}</td>
              <td className="px-3 py-2 text-xs tabular-nums text-scenario-ink">{signed(part.units)}</td>
            </TableRow>
          ))}
        </TableGrid>
      </PopoverContent>
    </Popover>
  );
}
