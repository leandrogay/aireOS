import PageLayout from "@/components/layout/PageLayout";
import InventoryTabs from "@/components/inventory/InventoryTabs";

// Inventory: overall stock for all customers, per-customer stock with days of
// holding (DOH), the at-risk list, the sell-in plan, and inventory data entry. All
// data loading happens in the client tree under InventoryTabs.
export default function InventoryPage() {
  return (
    <PageLayout title="Inventory">
      <InventoryTabs />
    </PageLayout>
  );
}
