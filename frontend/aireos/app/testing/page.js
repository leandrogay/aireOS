import PageLayout from '@/components/layout/PageLayout';

import DropdownGallery from './DropdownGallery';

// A living reference for the shared dropdown kit (components/ui/Dropdown,
// SelectDropdown, MultiSelectDropdown, MonthDropdown): every variant with
// sample data, to look at and try. Not linked from the sidebar, so it is only
// reached by URL. Add a variant here when you add one to the kit.
export default function TestingPage() {
  return (
    <PageLayout title="Dropdown components">
      <DropdownGallery />
    </PageLayout>
  );
}
