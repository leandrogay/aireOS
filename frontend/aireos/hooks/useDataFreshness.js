"use client"

import { useEffect, useRef, useState } from "react"

export const FRESHNESS_POLL_MS = 15_000

function channelStampChanged(previous, next) {
  const modes = new Set([...Object.keys(previous || {}), ...Object.keys(next || {})])
  for (const key of modes) {
    if ((previous?.[key]?.lastUpdated ?? null) !== (next?.[key]?.lastUpdated ?? null)) {
      return true
    }
  }
  return false
}

/**
 * Polls /api/sales/last-updated while the dashboard is open.
 * When any retailer's MAX(loaded_at) stamp changes, bumps dataVersion so
 * SalesOverview + SkuRanking can refetch without a manual page reload.
 */
export default function useDataFreshness(pollMs = FRESHNESS_POLL_MS) {
  const [channels, setChannels] = useState({})
  const [dataVersion, setDataVersion] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const previousRef = useRef(null)

  useEffect(() => {
    let cancelled = false

    async function fetchLastUpdated() {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/sales/last-updated`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || "Failed to load data freshness")
      return data.channels || {}
    }

    async function checkFreshness() {
      if (document.visibilityState === "hidden" && previousRef.current) return

      try {
        const channelsNext = await fetchLastUpdated()
        if (cancelled) return

        const previous = previousRef.current
        if (previous === null) {
          previousRef.current = channelsNext
          setChannels(channelsNext)
          return
        }

        if (!channelStampChanged(previous, channelsNext)) return

        setRefreshing(true)
        previousRef.current = channelsNext
        setChannels(channelsNext)
        setDataVersion((version) => version + 1)
      } catch {
        // Leave the last good stamps/version in place; child fetches surface errors.
      } finally {
        if (!cancelled) setRefreshing(false)
      }
    }

    checkFreshness()
    const intervalId = setInterval(checkFreshness, pollMs)

    return () => {
      cancelled = true
      clearInterval(intervalId)
    }
  }, [pollMs])

  return { channels, dataVersion, refreshing }
}
