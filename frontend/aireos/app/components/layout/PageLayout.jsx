import AppShell from "./AppShell";
import NotificationBell from "./NotificationBell";
import { cn } from "@/lib/utils";

/**
 * Standard content page: sidebar shell, cream background, a max-w-6xl
 * centred column and the page heading. Keeps the heading position and
 * gutters identical across pages. The notification bell sits at the right
 * end of every page's heading row.
 *
 * `headerExtra` renders inline to the right of the title (e.g. a selector);
 * give it `ml-auto` to push it to the right, just before the bell.
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
          <div className="mb-3 flex items-center gap-3">
            {/* The title and any page controls share this growing block, so a
                control pushed right with ml-auto stays just left of the bell. */}
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
              <h1 className="font-serif text-2xl text-deep-violet-blue">
                {title}
              </h1>
              {headerExtra}
            </div>
            <NotificationBell />
          </div>
          {children}
        </div>
      </main>
    </AppShell>
  );
}
