import AppShell from "./AppShell";
import NotificationBell from "./NotificationBell";
import PageTransition from "./PageTransition";
import BackLink from "@/components/ui/BackLink";
import { cn } from "@/lib/utils";

/**
 * Standard content page: sidebar shell, AIRE glass background, a max-w-6xl
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
 * `fitScreen` fills the window on wider screens, so a table can scroll inside
 * its card. On mobile the page grows with its cards instead, leaving scroll
 * room below pagination for the floating assistant button.
 *
 * `wide` lets a dense dashboard use a wider content column.
 *
 * @param {{ title: import('react').ReactNode, headerExtra?: import('react').ReactNode, back?: { href: string, label: string }, fitScreen?: boolean, wide?: boolean, children: import('react').ReactNode }} props
 */
export default function PageLayout({ title, headerExtra, back, fitScreen = false, wide = false, children }) {
  return (
    <AppShell>
      {/* Room after the last card for the assistant's floating button
          (AssistantWidget: 48px, 16px from the bottom). */}
      <main
        className={cn(
          "min-w-0 px-4 pt-4 pb-20 md:px-6 md:pt-6",
          fitScreen ? "flex min-h-dvh flex-col sm:h-dvh sm:overflow-y-auto" : "min-h-screen",
        )}
      >
        {/* The column springs in on navigation (PageTransition); the sidebar
            outside it stays still. */}
        <PageTransition className={cn(
          "mx-auto w-full min-w-0 max-w-6xl",
          wide && 'max-w-[1440px]',
          fitScreen && "flex min-h-0 flex-col sm:flex-1",
        )}>
          {/* data-page-heading: NotificationBell measures this row, as wide
              as the page content, to size its panel. */}
          <div data-page-heading className="mb-4 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 md:flex md:items-center">
            <div className="flex min-h-9 min-w-0 items-center gap-3 pl-10 md:flex-1 md:pl-0">
              {back && (
                <BackLink href={back.href} label={back.label} className="-mr-1.5 -ml-1" />
              )}
              <h1 className="min-w-0 font-serif text-xl leading-tight text-deep-violet-blue md:text-2xl">
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
