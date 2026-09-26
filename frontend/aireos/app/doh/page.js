import PageLayout from "@/components/layout/PageLayout";
import DohSettingsView from "@/components/settings/DohSettingsView";

// DOH Settings: every customer's DOH thresholds and alert toggle, with edit
// and reset to the global default. All data loading happens in the client
// tree under DohSettingsView (backend /api/settings/doh).
export default function DOHSettingsPage() {
  return (
    <PageLayout title="DOH Settings">
      <DohSettingsView />
    </PageLayout>
  );
}
