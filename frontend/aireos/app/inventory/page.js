import PageLayout from "@/components/layout/PageLayout";

// Placeholder route — reserves the /inventory link in the sidebar for future
// development; no functionality here yet.
export default function InventoryPage() {
  return (
    <PageLayout title="Inventory">
      <div className="bg-white rounded-lg border border-lavander shadow-sm p-6">
        <p className="text-deep-violet-blue/70 text-sm">
          This page is a placeholder for future development.
        </p>
      </div>
    </PageLayout>
  );
}
