import AppShell from "./AppShell";

/**
 * Standard content page: sidebar shell, cream background, a max-w-6xl
 * centred column and the page heading. Keeps the heading position and
 * gutters identical across pages
 *
 * `headerExtra` renders inline to the right of the title (e.g. a selector).
 *
 * @param {{ title: import('react').ReactNode, headerExtra?: import('react').ReactNode, children: import('react').ReactNode }} props
 */
export default function PageLayout({ title, headerExtra, children }) {
  return (
    <AppShell>
      <main className="min-h-screen bg-cream px-4 py-4">
        <div className="max-w-6xl mx-auto">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <h1 className="font-serif text-2xl text-deep-violet-blue">
              {title}
            </h1>
            {headerExtra}
          </div>
          {children}
        </div>
      </main>
    </AppShell>
  );
}
