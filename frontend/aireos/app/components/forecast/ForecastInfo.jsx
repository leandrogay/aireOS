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
 * A small ⓘ with one forecastHelpText HELP entry, in the shared dark hint
 * look (ui/InfoTooltip): opens on hover and on click or tap, closes with
 * Escape. Its "Learn more" opens the help panel at the entry's section
 * (?help=<section>). Nothing outside ForecastHelpProvider.
 *
 * @param {{ helpKey: string, label?: string, className?: string }} props
 */
export default function ForecastInfo({ helpKey, label = 'What this means', className }) {
  const openHelp = useContext(ForecastHelpContext);
  if (!openHelp) return null;
  return (
    <span className={className}>
      <InfoTooltip label={label} learnMore={{ onClick: () => openHelp(helpSection(helpKey)) }}>
        {helpText(helpKey)}
      </InfoTooltip>
    </span>
  );
}
