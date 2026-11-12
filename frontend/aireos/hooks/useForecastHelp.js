'use client';

import { useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { HELP_SECTION_IDS, parseHelpSection } from '@/app/utils/forecastHelpText';

/**
 * The "How this forecast works" panel's state, kept in the URL
 * (?help=<section>) so a link can open it at a section and Back closes it.
 * `openHelp(section)` opens it (the first section when none is given);
 * `onOpenChange(false)` (Escape or ✕) removes the parameter. `requests`
 * counts openHelp calls, so a second "Learn more" to the section already in
 * the URL still scrolls the panel back to it.
 *
 * @returns {{ data: { open: boolean, section: string | null, requests: number }, openHelp: (section?: string) => void, onOpenChange: (open: boolean) => void }}
 */
export default function useForecastHelp() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const section = parseHelpSection(searchParams.get('help'));
  const [requests, setRequests] = useState(0);

  function setHelp(value) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set('help', value);
    else params.delete('help');
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return {
    data: { open: section != null, section, requests },
    openHelp: (value) => {
      setRequests((count) => count + 1);
      setHelp(parseHelpSection(value) ?? HELP_SECTION_IDS[0]);
    },
    onOpenChange: (open) => {
      if (!open) setHelp(null);
    },
  };
}
