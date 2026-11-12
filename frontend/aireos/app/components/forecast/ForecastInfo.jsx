'use client';

import { createContext, useContext } from 'react';

import InfoTooltip from '@/components/ui/InfoTooltip';
import { helpSection, helpText } from '@/app/utils/forecastHelpText';

// The Sell-out Forecast page provides `openHelp(section)` (it opens the
// "How this forecast works" panel). The chart, filters and footer are shared
// with the Scenario builder, which provides nothing, so the ⓘ icons only
// appear on /forecast.
const ForecastHelpContext = createContext(null);

/**
 * Gives the components below ⓘ icons whose "Learn more" opens the help panel.
 *
 * @param {{ openHelp: (section: string) => void, children: import('react').ReactNode }} props
 */
export function ForecastHelpProvider({ openHelp, children }) {
  return <ForecastHelpContext.Provider value={openHelp}>{children}</ForecastHelpContext.Provider>;
}

/**
 * A small ⓘ with one forecastHelpText HELP entry: opens on hover and on
 * click or tap, closes with Escape. Nothing outside ForecastHelpProvider.
 *
 * @param {{ helpKey: string, label?: string, className?: string }} props
 */
export default function ForecastInfo({ helpKey, label = 'What this means', className }) {
  const openHelp = useContext(ForecastHelpContext);
  if (!openHelp) return null;
  return (
    <span className={className}>
      <InfoTooltip
        variant="card"
        label={label}
        footer={
          <button
            type="button"
            onClick={() => openHelp(helpSection(helpKey))}
            className="w-fit text-[11px] font-medium text-deep-violet-blue underline underline-offset-2 hover:text-deep-violet-blue/70"
          >
            Learn more
          </button>
        }
      >
        <span className="block leading-snug">{helpText(helpKey)}</span>
      </InfoTooltip>
    </span>
  );
}
