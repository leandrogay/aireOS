import Sidebar from './Sidebar';

// Standardized page shell — sidebar nav on the left, page content unchanged
// on the right. Shared by dashboard/page.js and upload/page.js (and any
// future page) so the nav stays identical everywhere instead of each page
// rolling its own. No background of its own: the page wash (aire-wash on
// <body>, app/layout.js) shows through, and the sidebar's glass blurs it.
export default function AppShell({ children }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
