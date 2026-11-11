'use client';

import Link from 'next/link';
import { AlertTriangle, ArrowRight, CheckCircle2, XCircle } from 'lucide-react';

import { buttonVariants } from '@/components/ui/button';
import { dashboardHrefForRetailer, loadedRetailers } from '@/app/utils/loadPreview';
import { retailerLabel } from '@/app/utils/retailerLabel';
import { cn } from '@/lib/utils';

function plural(count, one, many) {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

/**
 * One kind of result, drawn like a section of the upload list (UploadGroup):
 * an icon and label with a count, a one-line note, then a card per file.
 */
function ResultSection({ Icon, iconClass, label, note, items, children }) {
  return (
    <section>
      <h3 className="flex items-center gap-1.5 text-sm font-medium text-deep-violet-blue">
        <Icon aria-hidden="true" className={cn('size-4 shrink-0', iconClass)} />
        {label}
        <span className="font-normal text-ink-soft tabular-nums">({items.length})</span>
      </h3>
      {note && <p className="mt-0.5 pl-5.5 text-xs text-ink-soft">{note}</p>}
      <ul className="mt-2 space-y-2">
        {items.map((item) => (
          <li key={item.blob_path} className="rounded-md border border-lavander bg-white px-3 py-2">
            <p className="truncate text-sm font-medium text-deep-violet-blue" title={item.filename || item.blob_path}>
              {item.filename || item.blob_path}
            </p>
            <p className="mt-0.5 text-xs text-deep-violet-blue">{children(item)}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The mapping a file was loaded with, as the upload rows name it. */
function MappingLabel({ item }) {
  if (!item.mapping_name) return null;
  return (
    <>
      {' · '}
      <span className="font-medium">{item.mapping_name}</span>
      {item.mapping_version && <> · version {item.mapping_version}</>}
    </>
  );
}

/**
 * What a load did, once it has answered: the files written to sales data,
 * the ones only read because saving is switched off, and the ones that
 * failed -- each a section in the upload list's style -- then, when rows
 * were written, the same footer bar as the confirmation step with the way on
 * to the dashboard. There is no Done: the dialog's X closes it.
 *
 * @param {{ outcome: ReturnType<typeof import('@/app/utils/loadPreview').loadOutcome>, files: object[] }} props
 */
export default function LoadResult({ outcome, files }) {
  const retailers = loadedRetailers(outcome, files);
  return (
    <>
      <div role="status" className="max-h-[60vh] space-y-4 overflow-y-auto px-4 py-4">
        {outcome.saved.length > 0 && (
          <ResultSection
            Icon={CheckCircle2}
            iconClass="text-green-700"
            label="Loaded"
            note={`${plural(outcome.rows, 'sales row', 'sales rows')} written. The dashboard and inventory show them now.`}
            items={outcome.saved}
          >
            {(item) => (
              <>
                <span className="font-medium text-green-700">
                  {plural(item.processing?.rows_stored || 0, 'row', 'rows')} loaded
                </span>
                <MappingLabel item={item} />
              </>
            )}
          </ResultSection>
        )}

        {outcome.checkedOnly.length > 0 && (
          <ResultSection
            Icon={AlertTriangle}
            iconClass="text-amber-800"
            label="Not saved"
            note="Saving is off in this environment, so these were read with the approved nomenclature and nothing was written. They're still waiting to load."
            items={outcome.checkedOnly}
          >
            {(item) => (
              <>
                <span className="text-amber-900">
                  {plural(item.processing?.rows_mapped || 0, 'valid row', 'valid rows')} read
                </span>
                <MappingLabel item={item} />
              </>
            )}
          </ResultSection>
        )}

        {outcome.failed.length > 0 && (
          <ResultSection
            Icon={XCircle}
            iconClass="text-red-700"
            label="Couldn't load"
            note="Nothing from these files was saved. They can be loaded again from Recent uploads."
            items={outcome.failed}
          >
            {(item) => <span className="text-red-700">{item.error}</span>}
          </ResultSection>
        )}
      </div>

      {/* ==== Actions ==== same bar as the confirmation step. The one way on
          is the dashboard, once rows were written; closing is the dialog's X. */}
      {outcome.saved.length > 0 && (
        <div className="flex flex-wrap items-center justify-end gap-2 rounded-b-lg border-t border-lavander bg-cream/40 px-4 py-3">
          {retailers.length > 1 && <span className="mr-auto text-xs text-ink-soft">View sales for a loaded retailer:</span>}
          {(retailers.length ? retailers : [null]).map((retailer) => (
            <Link
              key={retailer ?? 'all'}
              href={retailer ? dashboardHrefForRetailer(retailer) : '/dashboard'}
              className={buttonVariants()}
            >
              {retailer ? retailerLabel(retailer) : 'View Sales Dashboard'}
              <ArrowRight aria-hidden="true" />
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
