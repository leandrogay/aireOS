import AppShell from "./AppShell";
import { cn } from "@/lib/utils";

/**
 * Standard content page: sidebar shell, cream background, a max-w-6xl
 * centred column and the page heading. Keeps the heading position and
 * gutters identical across pages
 *
 * `headerExtra` renders inline to the right of the title (e.g. a selector).
 *
 * `fitScreen` makes the page exactly the window's height instead of growing
 * with its content: the content column becomes a flex column, so one child
 * can take `min-h-0 flex-1` and scroll inside itself (the promotions table).
 * If the window is too short for the content, the page scrolls as a fallback
 * rather than clipping it.
 *
 * @param {{ title: import('react').ReactNode, headerExtra?: import('react').ReactNode, fitScreen?: boolean, children: import('react').ReactNode }} props
 */
export default function PageLayout({ title, headerExtra, fitScreen = false, children }) {
  return (
    <AppShell>
      <main
        className={cn(
          "bg-cream px-4 py-4",
          fitScreen ? "flex h-dvh flex-col overflow-y-auto" : "min-h-screen",
        )}
      >
        <div className={cn("max-w-6xl mx-auto", fitScreen && "flex w-full min-h-0 flex-1 flex-col")}>
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
