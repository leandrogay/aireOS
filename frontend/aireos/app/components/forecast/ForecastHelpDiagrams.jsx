import { ArrowDown } from 'lucide-react';

import { INITIAL_TIMELINE_STEPS, UPDATE_FLOW_STEPS } from '@/app/utils/forecastHelpText';

// Plain HTML diagrams for the help panel (no chart library): steps in a
// column with arrows between them, so they read the same at phone width.

function StepColumn({ steps, label }) {
  return (
    <ol aria-label={label} className="flex flex-col items-stretch gap-0.5">
      {steps.map((step, index) => (
        <li key={step} className="flex flex-col items-center gap-0.5">
          <span className="w-full rounded-md border border-lavander bg-white px-2.5 py-1.5 text-center text-[11px] leading-snug text-deep-violet-blue">
            {step}
          </span>
          {index < steps.length - 1 ? (
            <ArrowDown aria-hidden="true" className="size-3 shrink-0 text-deep-violet-blue/45" />
          ) : null}
        </li>
      ))}
    </ol>
  );
}

/** Save in the app → … → bell (forecastHelpText UPDATE_FLOW_STEPS). */
export function UpdateFlow() {
  return <StepColumn steps={UPDATE_FLOW_STEPS} label="How an update runs" />;
}

/** 1 Sep → updated → locked 31 Oct (forecastHelpText INITIAL_TIMELINE_STEPS). */
export function InitialTimeline() {
  return <StepColumn steps={INITIAL_TIMELINE_STEPS} label="The yearly plan's timeline" />;
}

export const HELP_DIAGRAMS = { updateFlow: UpdateFlow, initialTimeline: InitialTimeline };
