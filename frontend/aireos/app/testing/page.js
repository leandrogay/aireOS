import PageLayout from '@/components/layout/PageLayout';

import DropdownGallery from './DropdownGallery';

// TEMPORARY: a gallery of every dropdown variant for reviewing the dropdown
// refactor. Delete this folder once the review is done.
export default function TestingPage() {
  return (
    <PageLayout title="Dropdown variants (temporary)">
      <DropdownGallery />
    </PageLayout>
  );
}
