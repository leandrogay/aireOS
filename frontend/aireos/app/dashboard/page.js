'use client';

import SkuRanking from "../components/SkuRanking";

export default function DashboardPage() {

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-2xl font-semibold text-gray-900 mb-6">Sales Dashboard</h1>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
          <div className="bg-white rounded-lg border border-gray-200 p-5">
            <p className="text-sm text-gray-500">Total Orders</p>
            <p className="text-2xl font-semibold text-gray-900">{100}</p>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-5">
            <p className="text-sm text-gray-500">Total Revenue</p>
            <p className="text-2xl font-semibold text-gray-900">${"10,000"}</p>
          </div>
        </div>
        <SkuRanking />
      </div>

    </main>
  );
}