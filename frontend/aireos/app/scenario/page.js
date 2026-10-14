import PageLayout from '@/components/layout/PageLayout';
import ScenarioBuilder from '@/components/scenario/ScenarioBuilder';

// Forecast › Scenario builder: test building blocks and draft promotions on
// top of the Current forecast without changing it. All data loading and the
// draft state live in the client tree under ScenarioBuilder.
export default function ScenarioBuilderPage() {
  return (
    <PageLayout title="Scenario builder">
      <ScenarioBuilder />
    </PageLayout>
  );
}
