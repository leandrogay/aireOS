import PageLayout from '@/components/layout/PageLayout';

import ButtonGallery from './ButtonGallery';
import ChartGallery from './ChartGallery';
import DatePickerGallery from './DatePickerGallery';
import DropdownGallery from './DropdownGallery';
import { Category } from './GalleryParts';
import TableGallery from './TableGallery';
import ToggleGallery from './ToggleGallery';

// A living reference for the shared kits, one Category each: buttons
// (components/ui/button), dropdowns (Dropdown, SelectDropdown,
// MultiSelectDropdown, MonthDropdown), date pickers (DatePicker,
// RangeDatePicker on ui/calendar), toggles (SegmentedControl,
// ToggleButton, ToggleField), tables (DataTable, TableGrid, TableCard and
// the row parts) and charts (ChartCard, ChartFrame). A kit opens and closes (closed to start with,
// so only the names show); everything inside it is open. Every kit has the
// same blocks: "Which to use", its components, then "Not migrated yet" (the
// pages still on the old version, with the old and new side by side). See
// GalleryParts.jsx. Not linked from the sidebar, so it is only reached by URL.
// Add a variant to its kit's gallery when you add one, and a new Category
// here for a new kit.
export default function TestingPage() {
  return (
    <PageLayout title="Shared components">
      <Category title="Buttons" note="Button variants, sizes, icons and states">
        <ButtonGallery />
      </Category>
      <Category title="Dropdowns" note="SelectDropdown, MultiSelectDropdown, MonthDropdown, Dropdown">
        <DropdownGallery />
      </Category>
      <Category title="Date pickers" note="DatePicker, RangeDatePicker, Calendar">
        <DatePickerGallery />
      </Category>
      <Category title="Toggles" note="SegmentedControl, ToggleButton, ToggleField">
        <ToggleGallery />
      </Category>
      <Category title="Tables" note="PaginatedDataTable, DataTable, TableGrid, TableCard, row parts">
        <TableGallery />
      </Category>
      <Category title="Charts" note="ChartCard, ChartFrame, chart skeletons and tooltip">
        <ChartGallery />
      </Category>
    </PageLayout>
  );
}
