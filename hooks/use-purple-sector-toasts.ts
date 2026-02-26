"use client"

import { useEffect, useRef } from "react"
import { toast } from "sonner"
import { getSessionKey, cachedFetch, now as simNow } from "@/lib/simulation"

const WILLIAMS_DRIVERS: Record<number, string> = { 23: "Albon", 55: "Sainz" }

interface LapEntry {
  driver_number: number
  lap_number: number
  is_pit_out_lap: boolean
  sector_1_duration: number | null
  sector_2_duration: number | null
  sector_3_duration: number | null
  lap_duration: number | null
  date_start: string
}

type SectorKey = "sector_1_duration" | "sector_2_duration" | "sector_3_duration" | "lap_duration"

const SECTOR_LABELS: Record<SectorKey, string> = {
  sector_1_duration: "Sector 1",
  sector_2_duration: "Sector 2",
  sector_3_duration: "Sector 3",
  lap_duration: "Best Lap",
}

export function usePurpleSectorToasts() {
  const bestTimes = useRef<Record<SectorKey, number>>({
    sector_1_duration: Infinity,
    sector_2_duration: Infinity,
    sector_3_duration: Infinity,
    lap_duration: Infinity,
  })

  const lastNotified = useRef<Set<string>>(new Set())
  const initialized = useRef(false)

  useEffect(() => {
    let stale = false

    function poll() {
      const sk = getSessionKey()
      const simTime = simNow()
      const simIso = simTime.toISOString()

      cachedFetch<LapEntry[]>(
        `https://api.openf1.org/v1/laps?session_key=${sk}&date_start%3C=${encodeURIComponent(simIso)}`
      )
        .then((laps) => {
          if (stale || !Array.isArray(laps)) return

          const validLaps = laps.filter((l) => !l.is_pit_out_lap)

          const newBests: Record<SectorKey, number> = { ...bestTimes.current }
          const sectors: SectorKey[] = ["sector_1_duration", "sector_2_duration", "sector_3_duration", "lap_duration"]

          // First pass: compute session-best for each sector across ALL drivers
          for (const lap of validLaps) {
            for (const key of sectors) {
              const val = lap[key]
              if (val != null && val > 0 && val < newBests[key]) {
                newBests[key] = val
              }
            }
          }

          // Second pass: check if a Williams driver holds any new session-best
          if (initialized.current) {
            for (const lap of validLaps) {
              const driverName = WILLIAMS_DRIVERS[lap.driver_number]
              if (!driverName) continue

              for (const key of sectors) {
                const val = lap[key]
                if (val == null || val <= 0) continue
                if (val > newBests[key]) continue // not session-best

                const dedupeKey = `${key}-${lap.driver_number}-${val}`
                if (lastNotified.current.has(dedupeKey)) continue

                // This Williams driver holds the session-best for this sector
                if (val < bestTimes.current[key] || bestTimes.current[key] === Infinity) {
                  lastNotified.current.add(dedupeKey)
                  const label = SECTOR_LABELS[key]
                  const timeStr = key === "lap_duration"
                    ? formatLapTime(val)
                    : val.toFixed(3) + "s"

                  toast(`${driverName} — Purple ${label}!`, {
                    description: `${timeStr} — Session best`,
                    duration: 5000,
                    style: {
                      background: "#7C3AED",
                      color: "#FFFFFF",
                      border: "1px solid rgba(124,58,237,0.5)",
                    },
                  })
                }
              }
            }
          }

          bestTimes.current = newBests
          initialized.current = true
        })
        .catch(() => {})
    }

    poll()
    const timer = setInterval(poll, 30_000)
    return () => {
      stale = true
      clearInterval(timer)
    }
  }, [])
}

function formatLapTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds - mins * 60
  return mins > 0 ? `${mins}:${secs.toFixed(3).padStart(6, "0")}` : `${secs.toFixed(3)}s`
}
