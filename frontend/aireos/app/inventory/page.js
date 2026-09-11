import AppShell from '@/components/layout/AppShell';

// Placeholder route — reserves the /inventory link in the sidebar for future
// development; no functionality here yet.
export default function InventoryPage() {
  return (
    <AppShell>
      <main className="min-h-screen bg-cream px-4 py-4">
        <div className="max-w-6xl mx-auto">
          <h1 className="font-serif text-2xl text-deep-violet-blue mb-3">Inventory</h1>
          <div className="bg-white rounded-lg border border-lavander shadow-sm p-6">
            <p className="text-deep-violet-blue/70 text-sm">
              This page is a placeholder for future development.
            </p>
          </div>
        </div>
      </main>
    </AppShell>
  );
}
