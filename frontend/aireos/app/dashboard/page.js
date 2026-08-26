'use client';

import SkuRanking from "@/components/dashboard/SkuRanking";
import SalesOverview from "@/components/dashboard/SalesOverview";

export default function DashboardPage() {
  return (
    <main className="min-h-screen bg-background px-4 py-10">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-2xl font-semibold text-foreground mb-6">Sales Dashboard</h1>

        <SalesOverview />
        <SkuRanking />
      </div>
    </main>
  );
}
