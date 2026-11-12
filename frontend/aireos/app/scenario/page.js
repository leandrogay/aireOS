import PageLayout from '@/components/layout/PageLayout';
import InfoTooltip from '@/components/ui/InfoTooltip';
import ScenarioWorkspace from '@/components/scenario/ScenarioWorkspace';

// The one place the page says it is a sandbox: a chip beside the title,
// with the detail in its hint, instead of a banner over the content.
const sandboxBadge = (
  <span className="inline-flex items-center gap-1 rounded-full border border-lavander bg-lavander/70 py-0.5 pl-2.5 pr-1 text-[11px] font-medium text-deep-violet-blue">
    Sandbox
    <InfoTooltip label="About the sandbox">
      Current-mode entries move the Simulated line. Budget planning uses Initial as its base; locking a budget publishes a frozen Budget comparison on Forecast and Inventory.
    </InfoTooltip>
  </span>
);

// Forecast › Scenario builder: test building blocks and draft promotions on
// top of the Current forecast without changing it. All data loading and the
// building-block state live in the client tree under ScenarioBuilder.
export default function ScenarioBuilderPage() {
  return (
    <PageLayout title="Scenario builder" headerExtra={sandboxBadge} wide>
      <ScenarioWorkspace />
    </PageLayout>
  );
}
