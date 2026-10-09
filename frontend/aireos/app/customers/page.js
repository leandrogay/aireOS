import CustomersView from '@/components/customers/CustomersView';

// Customers: every customer and the retailers under it, with add, rename and
// delete. All data loading happens in the client tree under CustomersView
// (backend /api/catalog/customers and /api/catalog/retailers).
export default function CustomersPage() {
  return <CustomersView />;
}
