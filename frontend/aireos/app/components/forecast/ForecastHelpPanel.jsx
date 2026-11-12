'use client';

import { useEffect, useRef } from 'react';
import { CircleHelp } from 'lucide-react';

import Disclosure from '@/components/ui/Disclosure';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { HELP_DIAGRAMS } from '@/components/forecast/ForecastHelpDiagrams';
import { HELP_SECTIONS, HELP_SECTION_IDS } from '@/app/utils/forecastHelpText';

/** The page header's "How this works" button, which opens the panel. */
export function ForecastHelpButton({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-7 items-center gap-1 rounded-full border border-lavander bg-white px-2.5 text-[11px] font-medium text-deep-violet-blue transition hover:bg-cream"
    >
      <CircleHelp aria-hidden="true" className="size-3.5" />
      How this works
    </button>
  );
}

function Block({ block }) {
  if (block.p) return <p className="leading-relaxed">{block.p}</p>;
  if (block.list) {
    return (
      <ul className="list-disc space-y-1 pl-4 leading-relaxed">
        {block.list.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    );
  }
  if (block.qa) {
    return (
      <dl className="space-y-1.5">
        {block.qa.map(([term, answer]) => (
          <div key={term}>
            <dt className="font-medium">{term}</dt>
            <dd className="leading-relaxed text-deep-violet-blue/75">{answer}</dd>
          </div>
        ))}
      </dl>
    );
  }
  const Diagram = HELP_DIAGRAMS[block.diagram];
  return Diagram ? <Diagram /> : null;
}

/**
 * "How this forecast works": a side panel beside the chart (not modal, so
 * the chart stays usable), one collapsible section per HELP_SECTIONS entry.
 * `section` (from ?help=) opens that section and scrolls to it. `extras`
 * are drawn at the end of a section, by id, for what comes from the data
 * (e.g. { missing: <ForecastMissingMonths /> }).
 *
 * @param {{
 *   open: boolean,
 *   section: string | null,
 *   onOpenChange: (open: boolean) => void,
 *   requests?: number,
 *   extras?: Record<string, import('react').ReactNode>,
 * }} props
 */
export default function ForecastHelpPanel({ open, section, onOpenChange, requests = 0, extras = {} }) {
  const sectionRefs = useRef({});

  useEffect(() => {
    if (!open || !section) return;
    // After the sheet has rendered its sections.
    const frame = requestAnimationFrame(() => {
      sectionRefs.current[section]?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(frame);
  // `requests`: every Learn more scrolls, even to the section already open.
  }, [open, section, requests]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent side="right" className="text-deep-violet-blue">
        <SheetHeader>
          <SheetTitle className="font-serif text-lg">How this forecast works</SheetTitle>
          <SheetDescription>Every line, model and number on this page, in plain words.</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-4 text-xs">
          {HELP_SECTION_IDS.map((id, index) => {
            const content = HELP_SECTIONS[id];
            return (
              <section
                // Remounted on each Learn more to it, so it reopens if it was closed.
                key={section === id ? `${id}-open-${requests}` : id}
                id={`forecast-help-${id}`}
                ref={(node) => {
                  sectionRefs.current[id] = node;
                }}
                className="scroll-mt-2"
              >
                <Disclosure
                  summary={`${index + 1}. ${content.title}`}
                  open={section ? section === id : index === 0}
                >
                  <div className="space-y-2 px-2 pt-1 pb-2">
                    {content.blocks.map((block, blockIndex) => (
                      <Block key={blockIndex} block={block} />
                    ))}
                    {extras[id] ?? null}
                  </div>
                </Disclosure>
              </section>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
