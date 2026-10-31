import { LayoutDashboard, Library, Package, Tag, TrendingUp, Upload } from 'lucide-react';

// The app's sections, shared by the sidebar (components/layout/Sidebar.jsx)
// and the landing page's section grid (components/landing/ModuleGrid.jsx), so
// adding a page in one place shows it in both.
//
// A plain module rather than part of Sidebar.jsx: Sidebar is a client
// component, and a server component (the landing page) can't read a constant
// exported from a 'use client' file.
//
// `description` is only shown on the landing page. Children appear under
// their parent in the sidebar while the user is inside that section.
export const NAV_ITEMS = [
  {
    label: 'Upload',
    href: '/upload',
    icon: Upload,
    description: 'Bring in retailer sell-out files. Layouts seen before load straight in.',
    children: [{ label: 'Nomenclatures', href: '/mappings' }],
  },
  {
    label: 'Dashboard',
    href: '/dashboard',
    icon: LayoutDashboard,
    description: 'Revenue and units by customer, channel, store format and SKU.',
  },
  {
    label: 'Forecast',
    href: '/forecast',
    icon: TrendingUp,
    description: 'Monthly sell-out forecast against actuals, by customer and SKU.',
  },
  {
    label: 'Promotions',
    href: '/promotions',
    icon: Tag,
    description: 'Plan promotion events by store, period, mechanic and SKU.',
  },
  {
    label: 'Inventory',
    href: '/inventory',
    icon: Package,
    description: 'Ending stock, days of holding and a sell-in plan per customer.',
    children: [{ label: 'DOH settings', href: '/doh' }],
  },
  // Catalog has no page of its own, so it links to its first child.
  {
    label: 'Catalog',
    href: '/skus',
    icon: Library,
    description: 'Maintain the SKU list and the customers that sell it.',
    children: [
      { label: 'SKUs', href: '/skus' },
      { label: 'Customers', href: '/customers' },
    ],
  },
];
