'use client';

import Link from 'next/link';
import { CloudOff, FileSpreadsheet } from 'lucide-react';

import { Button, buttonVariants } from '@/components/ui/button';
import GlassPanel from '@/components/dashboard/GlassPanel';
import { cn } from '@/lib/utils';

const primaryButtonClass = 'mt-4 bg-deep-violet-blue text-white hover:bg-deep-violet-blue/90';

/**
 * The whole Sales Dashboard's message when there is nothing to chart: the
 * customer list couldn't be read ('failed', with the server's own reason
 * underneath), or no sales have been uploaded yet ('empty'). One card in
 * place of every section, rather than each section saying it is empty.
 *
 * @param {{ kind: 'failed' | 'empty', error?: string | null }} props
 */
export default function DashboardStatus({ kind, error = null }) {
  const failed = kind === 'failed';
  const Icon = failed ? CloudOff : FileSpreadsheet;

  return (
    <GlassPanel
      as="div"
      role={failed ? 'alert' : 'status'}
      className="flex min-h-[420px] flex-col items-center justify-center p-8 text-center"
    >
      <span className="mb-3 flex size-12 items-center justify-center rounded-full bg-lavander text-deep-violet-blue">
        <Icon className="size-6" aria-hidden="true" />
      </span>
      <h2 className="font-serif text-lg text-deep-violet-blue">
        {failed ? 'Couldn’t load sales data' : 'No sales data yet'}
      </h2>
      <p className="mt-1 max-w-sm text-sm text-deep-violet-blue/70">
        {failed
          ? 'The sales data didn’t load. Check your connection, then try again.'
          : 'Upload a retailer sell-out file and its sales will appear here.'}
      </p>
      {failed && error && <p className="mt-2 max-w-md text-xs text-deep-violet-blue/50">{error}</p>}
      {failed ? (
        <Button onClick={() => window.location.reload()} className={primaryButtonClass}>
          Try again
        </Button>
      ) : (
        <Link href="/upload" className={cn(buttonVariants(), primaryButtonClass)}>
          Go to Upload
        </Link>
      )}
    </GlassPanel>
  );
}
