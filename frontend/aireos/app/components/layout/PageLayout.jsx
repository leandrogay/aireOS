import AppShell from "./AppShell";
import NotificationBell from "./NotificationBell";
import PageTransition from "./PageTransition";
import BackLink from "@/components/ui/BackLink";
import { cn } from "@/lib/utils";

/**
 * Standard content page: sidebar shell over the page wash, a max-w-6xl
 * centred column and the page heading. Keeps the heading position and
 * gutters identical across pages. The notification bell sits at the right
 * end of every page's heading row.
 *
 * `headerExtra` renders inline to the right of the title (e.g. a selector);
 * give it `ml-auto` to push it to the right, just before the bell.
 *
 * `back` ({ href, label }) puts a back arrow just left of the title, for
 * pages one level below another (a detail page under its list).
 *
 * `fitScreen` makes the page exactly the window's height instead of growing
 * with its content: the content column becomes a flex column, so one child
 * can take `min-h-0 flex-1` and scroll inside itself (the promotions table).
 * If the window is too short for the content, the page scrolls as a fallback
 * rather than clipping it.
 *
 * @param {{ title: import('react').ReactNode, headerExtra?: import('react').ReactNode, back?: { href: string, label: string }, fitScreen?: boolean, children: import('react').ReactNode }} props
 */
export default function PageLayout({ title, headerExtra, back, fitScreen = false, children }) {
  return (
    <AppShell>
      {/* pb-20: room under the last card for the assistant's floating button
          (AssistantWidget: 48px, 16px from the bottom), so it never sits on
          a table's pagination or any other bottom-right control. */}
      <main
        className={cn(
          // No background: the page wash (app/layout.js) shows through.
          "min-w-0 px-4 pt-4 pb-20",
          fitScreen ? "flex h-dvh flex-col overflow-y-auto" : "min-h-screen",
        )}
      >
        {/* The column springs in on navigation (PageTransition); the sidebar
            outside it stays still. */}
        <PageTransition className={cn("mx-auto w-full min-w-0 max-w-6xl", fitScreen && "flex min-h-0 flex-1 flex-col")}>
          {/* data-page-heading: NotificationBell measures this row, as wide
              as the page content, to size its panel. */}
          <div data-page-heading className="mb-3 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 md:flex md:items-center">
            <div className="flex min-h-9 min-w-0 items-center gap-3 pl-10 md:flex-1 md:pl-0">
              {back && (
                <BackLink href={back.href} label={back.label} className="-mr-1.5 -ml-1" />
              )}
              {/* Slightly tightened and balanced, so a long title wraps evenly
                  rather than leaving one word on its own line. */}
              <h1 className="min-w-0 font-serif text-xl leading-tight tracking-[-0.01em] text-balance text-deep-violet-blue md:text-2xl">
                {title}
              </h1>
            </div>
            {headerExtra && (
              <div className="col-span-2 row-start-2 min-w-0 w-full md:col-auto md:row-auto md:ml-auto md:w-auto">
                {headerExtra}
              </div>
            )}
            <div className="col-start-2 row-start-1 md:col-auto md:row-auto"><NotificationBell /></div>
          </div>
          {children}
        </PageTransition>
      </main>
    </AppShell>
  );
}
