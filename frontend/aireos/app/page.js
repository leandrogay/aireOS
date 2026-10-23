import LandingActions from '@/components/landing/LandingActions';
import LandingHeader from '@/components/landing/LandingHeader';
import ModuleGrid from '@/components/landing/ModuleGrid';
import MonthlyCycle from '@/components/landing/MonthlyCycle';

export const metadata = {
  title: 'AireOS',
  description:
    "Aire's operations workspace: retailer sell-out uploads, sales dashboard, forecast, promotions and inventory planning.",
};

// Landing page. A server component with no data fetching, so it renders
// instantly and works before sign-in exists. It uses its own header instead of
// PageLayout: the sidebar belongs to the app, and this page is the way in.
export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-cream">
      <LandingHeader />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-12 sm:px-6 sm:py-16">
        <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_24rem] lg:gap-16">
          <div className="max-w-xl">
            <p className="text-xs font-medium uppercase tracking-wider text-deep-violet-blue/70">
              Aire operations workspace
            </p>
            <h1 className="mt-3 text-balance font-serif text-4xl leading-tight text-deep-violet-blue sm:text-5xl">
              From retailer spreadsheets to next month&apos;s sell-in plan
            </h1>
            <p className="mt-4 text-base leading-relaxed text-deep-violet-blue/80">
              AireOS reads the sell-out files each retailer sends and turns them into one view of
              sales, forecast, promotions and stock, so the team can decide what to ship to each
              customer.
            </p>
            <div className="mt-8">
              <LandingActions />
            </div>
          </div>

          <MonthlyCycle />
        </div>

        <div className="mt-16 sm:mt-20">
          <ModuleGrid />
        </div>
      </main>

      <footer className="border-t border-lavander">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-5 text-xs text-deep-violet-blue/70 sm:px-6">
          <span>AireOS · Team WIP × Aire</span>
          <span>Internal tool for the Aire team</span>
        </div>
      </footer>
    </div>
  );
}
