import PageLayout from "@/components/layout/PageLayout";
import InventoryTabs from "@/components/inventory/InventoryTabs";

// Inventory: the sell-in plan (opens first), stock for all customers,
// per-customer stock with days of holding (DOH), the at-risk list, and input data. All
// data loading happens in the client tree under InventoryTabs.
export default function InventoryPage() {
  return (
    <PageLayout title="Inventory">
      <InventoryTabs />
    </PageLayout>
  );
}
