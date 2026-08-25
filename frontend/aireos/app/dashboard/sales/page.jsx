"use client"

import { useState } from "react"
import { ModeToggle } from "@/components/dashboard/ModeToggle"
import { StoreFormatCards } from "@/components/dashboard/StoreFormatCards"
import { RevenueTrendChart } from "@/components/dashboard/RevenueTrendChart"
import mockData from "@/lib/mocks/sales-summary.json"

// swap mockData for a real fetch() to /api/dashboard/summary once the endpoint exists
export default function SalesDashboardPage() {
  const [mode, setMode] = useState("offline")
  const data = mockData[mode]

  return (
    <div className="max-w-5xl mx-auto space-y-6 p-6">
      <ModeToggle mode={mode} onModeChange={setMode} />
      <StoreFormatCards storeFormats={data.storeFormats} />
      <RevenueTrendChart
        weeklyByFormat={data.weeklyByFormat}
        weeklyTotal={data.weeklyTotal}
      />
    </div>
  )
}
