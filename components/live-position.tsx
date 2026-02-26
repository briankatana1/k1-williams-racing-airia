"use client"

import { useState, useEffect, useRef } from "react"
import { MapPin, Loader2 } from "lucide-react"
import { getSessionKey, cachedFetch, now as simNow } from "@/lib/simulation"
import { fetchCircuitLayout, findNearestCorner, MiniTrackMap, type CircuitLayout, type DriverPosition } from "./track-map"
import type { DriverId } from "./driver-selector"

export function LivePositionCard({ driver }: { driver: DriverId }) {
  const driverNum = driver === "albon" ? "23" : "55"
  const driverName = driver === "albon" ? "Albon" : "Sainz"

  const [circuit, setCircuit] = useState<CircuitLayout | null>(null)
  const [driverPos, setDriverPos] = useState<DriverPosition | null>(null)
  const [activeCorner, setActiveCorner] = useState<number | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [loading, setLoading] = useState(true)
  const prevDriverRef = useRef(driver)
  const prevCornerRef = useRef<number | null>(null)

  // Smooth corner transitions: prevent jumps to non-sequential corners on parallel track sections
  function smoothCorner(nearest: number | null, corners: { number: number; trackPosition: { x: number; y: number } }[], pos: DriverPosition): number | null {
    if (nearest == null) return nearest
    const prev = prevCornerRef.current
    if (prev == null) { prevCornerRef.current = nearest; return nearest }
    const total = corners.length
    if (total === 0) return nearest
    const diff = Math.abs(nearest - prev)
    const wrappedDiff = Math.min(diff, total - diff)
    if (wrappedDiff <= 4) { prevCornerRef.current = nearest; return nearest }
    // Large jump — only accept if driver is very close to the new corner
    const corner = corners.find(c => c.number === nearest)
    if (corner) {
      const dx = pos.x - corner.trackPosition.x
      const dy = pos.y - corner.trackPosition.y
      if (dx * dx + dy * dy <= 100 * 100) { prevCornerRef.current = nearest; return nearest }
    }
    return prev
  }

  // Reset on driver change
  useEffect(() => {
    if (prevDriverRef.current !== driver) {
      prevDriverRef.current = driver
      prevCornerRef.current = null
      setDriverPos(null)
      setActiveCorner(null)
      setLastUpdated(null)
      setLoading(true)
    }
  }, [driver])

  // Load circuit layout once
  useEffect(() => {
    let stale = false
    fetchCircuitLayout().then((layout) => {
      if (!stale && layout) setCircuit(layout)
    })
    return () => { stale = true }
  }, [])

  // Poll location data every 10s
  useEffect(() => {
    let stale = false

    async function poll() {
      const sk = getSessionKey()
      const simTime = simNow()
      // Round to nearest 5s so each poll gets a fresh cache key
      const rounded = new Date(Math.floor(simTime.getTime() / 5_000) * 5_000)
      const simIso = rounded.toISOString()
      const tenSecAgo = new Date(rounded.getTime() - 10_000).toISOString()

      try {
        const data = await cachedFetch<any[]>(
          `https://api.openf1.org/v1/location?session_key=${sk}&driver_number=${driverNum}&date%3C=${encodeURIComponent(simIso)}&date%3E=${encodeURIComponent(tenSecAgo)}`
        )

        if (stale) return

        if (Array.isArray(data) && data.length > 0) {
          const latest = data[data.length - 1]
          if (latest.x != null && latest.y != null) {
            const pos: DriverPosition = { x: latest.x, y: latest.y }
            setDriverPos(pos)
            const nearest = circuit ? findNearestCorner(pos, circuit.corners ?? []) : null
            setActiveCorner(smoothCorner(nearest, circuit?.corners ?? [], pos))
            setLastUpdated(new Date())
          }
        }
      } catch {
        // Non-critical — keep existing data
      } finally {
        if (!stale) setLoading(false)
      }
    }

    poll()
    const timer = setInterval(poll, 5_000)
    return () => { stale = true; clearInterval(timer) }
  }, [driver, driverNum, circuit])

  // Update activeCorner when circuit loads after position
  useEffect(() => {
    if (driverPos && circuit) {
      const nearest = findNearestCorner(driverPos, circuit.corners ?? [])
      setActiveCorner(smoothCorner(nearest, circuit.corners ?? [], driverPos))
    }
  }, [circuit, driverPos])

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#2563EB]/10 flex items-center justify-center border border-[#2563EB]/20">
            <MapPin className="w-5 h-5 text-[#2563EB]" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground text-sm">Track Position</h3>
            <p className="text-xs text-muted-foreground">#{driverNum} {driverName}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs text-emerald-400 font-mono">LIVE</span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto scrollbar-hide p-4" style={{ scrollbarWidth: "none", WebkitOverflowScrolling: "touch" }}>
        {loading && !driverPos ? (
          <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Loading track position...</span>
          </div>
        ) : (
          <>
            <MiniTrackMap layout={circuit} activeCorner={activeCorner} driverPos={driverPos} />

            {/* Stats row */}
            <div className="grid grid-cols-3 gap-3">
              <div className="flex flex-col items-center gap-1 px-3 py-3 rounded-xl bg-secondary/60 border border-border">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Sector</span>
                <span className="text-base font-mono font-bold text-foreground">
                  {activeCorner != null && circuit?.corners?.length
                    ? `S${Math.min(3, Math.ceil(activeCorner / (circuit.corners.length / 3)))}`
                    : "—"}
                </span>
              </div>
              <div className="flex flex-col items-center gap-1 px-3 py-3 rounded-xl bg-secondary/60 border border-border">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Turn</span>
                <span className="text-base font-mono font-bold text-foreground">
                  {activeCorner != null ? `T${activeCorner}` : "—"}
                </span>
              </div>
              <div className="flex flex-col items-center gap-1 px-3 py-3 rounded-xl bg-secondary/60 border border-border">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Updated</span>
                <span className="text-[11px] font-mono text-foreground">
                  {lastUpdated
                    ? lastUpdated.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
                    : "—"}
                </span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
