import PageLayout from '@/components/layout/PageLayout';

import DropdownGallery from './DropdownGallery';
import ToggleGallery from './ToggleGallery';

// A living reference for the shared kits: dropdowns (components/ui/Dropdown,
// SelectDropdown, MultiSelectDropdown, MonthDropdown) and toggles
// (SegmentedControl, ToggleButton, ToggleField). Every variant with sample
// data, to look at and try. Not linked from the sidebar, so it is only
// reached by URL. Add a variant here when you add one to a kit.
export default function TestingPage() {
  return (
    <PageLayout title="Shared components">
      <DropdownGallery />
      <ToggleGallery />
    </PageLayout>
  );
}
