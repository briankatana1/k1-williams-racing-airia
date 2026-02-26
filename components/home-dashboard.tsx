"use client"

import { useState, useEffect, useReducer, useRef } from "react"
import { ArrowLeft, TrendingUp, Activity, CircleDot, ChevronDown, ChevronUp, Loader2 } from "lucide-react"
import Image from "next/image"
import { DriverSelector, type DriverId } from "./driver-selector"
import { getStartLap, getSessionKey, getSessionsUrl, cachedFetch, sessionTypeToLabel, now as simNow } from "@/lib/simulation"
import { AskAiFab } from "./ask-ai"
import { fetchCircuitLayout, findNearestCorner, MiniTrackMap, type CircuitLayout, type DriverPosition } from "./track-map"
import { usePurpleSectorToasts } from "@/hooks/use-purple-sector-toasts"

// Typewriter hook — reveals text word-by-word
function useTypewriter(text: string, speed = 30): string {
  const [displayed, setDisplayed] = useState("")
  const prevTextRef = useRef("")

  useEffect(() => {
    if (!text || text === prevTextRef.current) return
    prevTextRef.current = text
    const words = text.split(/(\s+)/)
    let i = 0
    setDisplayed("")
    const timer = setInterval(() => {
      i++
      setDisplayed(words.slice(0, i).join(""))
      if (i >= words.length) clearInterval(timer)
    }, speed)
    return () => clearInterval(timer)
  }, [text, speed])

  return text ? displayed : ""
}

interface HomeDashboardProps {
  onBack: () => void
}

// --- Shared Live Data (fetched once by parent) ---

interface TyreStint {
  stint_number: number
  lap_start: number
  lap_end: number
  compound: string
  tyre_age_at_start: number
}

interface LiveData {
  laps: { lap_number: number; date_start: string }[]
  intervals: any[]
  stints: TyreStint[]
  carData: any[]
  location: any[]
  currentLap: number
  position: number | null
}

interface LiveDataProps {
  driver: DriverId
  driverName: string
  driverNum: string
  liveData: LiveData
}

const LIVE_DATA_DEFAULTS: LiveData = {
  laps: [],
  intervals: [],
  stints: [],
  carData: [],
  location: [],
  currentLap: getStartLap(30),
  position: null,
}

let _lastLiveDataFetchTime = 0

// --- Live Tension Tracker ---

type TensionTier = "MONITORING" | "BUILDING" | "DRS_ZONE" | "IMMINENT"

interface CommentaryBullet {
  id: string
  text: string
  tier: TensionTier
  timestamp: number
}

interface GapSnapshot {
  lap: number
  gap: number
  closingRate: number
  drsActive: boolean
}

interface OvertakeEvent {
  id: string
  lap: number
  description: string
  type: "ATTACKING" | "DEFENDING"
  driverNumber: string
}

interface TensionState {
  bullets: CommentaryBullet[]
  gapHistory: GapSnapshot[]
  overtakes: OvertakeEvent[]
  lastOvertake: OvertakeEvent | null
  loading: boolean
  error: string | null
}

type TensionAction =
  | { type: "FETCH_START" }
  | { type: "INTERVALS_UPDATE"; gaps: GapSnapshot[]; overtakes: OvertakeEvent[] }
  | { type: "AI_SUCCESS"; bullets: CommentaryBullet[] }
  | { type: "FETCH_ERROR"; error: string }
  | { type: "RESET" }

function tensionReducer(state: TensionState, action: TensionAction): TensionState {
  switch (action.type) {
    case "FETCH_START":
      return { ...state, loading: true, error: null }
    case "INTERVALS_UPDATE": {
      const existingDescs = new Set(state.overtakes.map((o) => o.description.toLowerCase().trim()))
      const newOvertakes = action.overtakes.filter((o) => !existingDescs.has(o.description.toLowerCase().trim()))
      return {
        ...state,
        gapHistory: action.gaps.slice(-12),
        overtakes: [...state.overtakes, ...newOvertakes].slice(0, 20),
        lastOvertake: newOvertakes.length > 0 ? newOvertakes[newOvertakes.length - 1] : state.lastOvertake,
      }
    }
    case "AI_SUCCESS": {
      const existingBullets = new Set(state.bullets.map((b) => b.text.toLowerCase().trim()))
      const newBullets = action.bullets.filter((b) => !existingBullets.has(b.text.toLowerCase().trim()))
      return {
        ...state,
        loading: false,
        error: null,
        bullets: [...newBullets, ...state.bullets].slice(0, 50),
      }
    }
    case "FETCH_ERROR":
      return { ...state, loading: false, error: action.error }
    case "RESET":
      return { bullets: [], gapHistory: [], overtakes: [], lastOvertake: null, loading: false, error: null }
  }
}

const TIER_COLORS: Record<TensionTier, { dot: string; label: string; text: string }> = {
  MONITORING: { dot: "bg-white/60", label: "text-muted-foreground", text: "text-muted-foreground" },
  BUILDING: { dot: "bg-yellow-400", label: "text-amber-400", text: "text-amber-200" },
  DRS_ZONE: { dot: "bg-emerald-400", label: "text-emerald-400", text: "text-emerald-200" },
  IMMINENT: { dot: "bg-red-500", label: "text-red-400", text: "text-red-200" },
}

function classifyTier(text: string): TensionTier {
  const lower = text.toLowerCase()
  // Extract gap numbers
  const gapMatch = lower.match(/gap\s*(?:of\s+)?(\d+\.?\d*)\s*s|(\d+\.?\d*)\s*seconds?\s*(?:behind|ahead|gap)/i)
  const gap = gapMatch ? parseFloat(gapMatch[1] ?? gapMatch[2]) : null

  const overtakeKeywords = /\b(passed|overtook|overtaken|overtake|move|position gained|lunged|divebomb)\b/
  if (gap !== null && gap <= 0.5 || overtakeKeywords.test(lower)) return "IMMINENT"
  if (gap !== null && gap <= 1.0 || /\bdrs\b/.test(lower)) return "DRS_ZONE"
  if (gap !== null && gap <= 2.0 || /\b(closing|pressure|attack)\b/.test(lower)) return "BUILDING"
  return "MONITORING"
}

/** Build gap snapshots + detect overtakes directly from OpenF1 intervals data */
function buildFromIntervals(
  intervals: { interval: number | null; gap_to_leader: number | null; date: string }[],
  laps: { lap_number: number; date_start: string }[],
  driverNum: string,
): { gaps: GapSnapshot[]; overtakes: OvertakeEvent[] } {
  const gaps: GapSnapshot[] = []
  const overtakes: OvertakeEvent[] = []

  // Build a lookup: timestamp → real lap number
  function toLap(dateStr: string): number {
    const t = new Date(dateStr).getTime()
    let best = getStartLap(30)
    for (const l of laps) {
      if (new Date(l.date_start).getTime() <= t) best = l.lap_number
      else break
    }
    return best
  }

  // Only use entries that have a real interval value (gap to car ahead)
  const valid = intervals.filter((r) => r.interval != null)

  for (let i = 0; i < valid.length; i++) {
    const r = valid[i]
    const gap = r.interval!
    const prevGap = i > 0 ? valid[i - 1].interval! : gap
    const closingRate = prevGap - gap
    const lap = toLap(r.date)

    gaps.push({
      lap: i, // index for sparkline ordering
      gap: Math.abs(gap),
      closingRate,
      drsActive: Math.abs(gap) <= 1.0,
    })

    // Detect overtake: position change shows as a big interval discontinuity
    if (i > 0) {
      const prev = valid[i - 1].interval!
      const curr = gap
      const delta = curr - prev

      if (prev <= 1.5 && delta > 2.0) {
        overtakes.push({
          id: `ot-${r.date}`,
          lap,
          description: `#${driverNum} overtook on lap ${lap} — gap was ${prev.toFixed(1)}s, now ${curr.toFixed(1)}s to next car ahead`,
          type: "ATTACKING",
          driverNumber: driverNum,
        })
      }
      else if (prev > 2.0 && delta < -2.0 && curr <= 1.5) {
        overtakes.push({
          id: `ot-${r.date}`,
          lap,
          description: `#${driverNum} lost a position on lap ${lap} — interval dropped from ${prev.toFixed(1)}s to ${curr.toFixed(1)}s`,
          type: "DEFENDING",
          driverNumber: driverNum,
        })
      }
    }
  }

  return { gaps, overtakes }
}

/* ---------- Zone 1: Commentary Feed ---------- */
function CommentaryFeed({ bullets, loading }: { bullets: CommentaryBullet[]; loading: boolean }) {
  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="px-5 py-3 border-b border-border">
        <span className="text-xs font-mono text-[#2563EB] uppercase tracking-wider">AI Commentary</span>
      </div>
      <div>
        {loading && bullets.length === 0 && (
          <div className="flex items-center gap-2 px-5 py-4 text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span className="text-xs">Analyzing race tension...</span>
          </div>
        )}
        {bullets.length === 0 && !loading && (
          <p className="px-5 py-4 text-xs text-muted-foreground">Waiting for data...</p>
        )}
        <div className="flex flex-col">
          {bullets.map((b) => {
            const colors = TIER_COLORS[b.tier]
            return (
              <div key={b.id} className="flex items-start gap-2.5 px-5 py-2.5 border-b border-border/50 last:border-0">
                <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${colors.dot}`} />
                <div className="min-w-0 flex-1">
                  <span className={`text-[10px] font-mono uppercase tracking-wider ${colors.label}`}>{b.tier.replace("_", " ")}</span>
                  <p className={`text-xs leading-relaxed mt-0.5 ${colors.text}`}>{b.text}</p>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/* ---------- Zone 2: Gap Visualizer ---------- */
function GapVisualizer({ gapHistory, driverNum, overtakeLaps }: { gapHistory: GapSnapshot[]; driverNum: string; overtakeLaps: Set<number> }) {
  const latest = gapHistory.length > 0 ? gapHistory[gapHistory.length - 1] : null
  const maxGap = Math.max(...gapHistory.map((g) => g.gap), 3)

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-border">
        <span className="text-xs font-mono text-[#2563EB] uppercase tracking-wider">Gap to Car Ahead</span>
        <span className="text-[10px] font-mono text-muted-foreground">#{driverNum}</span>
      </div>
      <div className="p-5">
        {gapHistory.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">Gathering data...</p>
        ) : (
          <>
            {/* Sparkline */}
            <div className="relative h-24 mb-4 rounded-xl bg-secondary/40 border border-border p-3 overflow-hidden">
              <div className="flex items-end gap-1 h-full">
                {gapHistory.map((g, i) => {
                  const height = (g.gap / maxGap) * 100
                  const isClosing = i > 0 && g.gap < gapHistory[i - 1].gap
                  const isOvertake = overtakeLaps.has(g.lap)
                  return (
                    <div key={`gap-${g.lap}`} className="flex-1 flex flex-col items-center gap-0.5 h-full justify-end">
                      {isOvertake && (
                        <span className="text-[8px] leading-none animate-pulse">⚡</span>
                      )}
                      <div
                        className={`w-full rounded-t transition-all duration-500 ${isOvertake ? "ring-1 ring-amber-400/60" : ""}`}
                        style={{
                          height: `${height}%`,
                          backgroundColor: isOvertake ? "#F59E0B" : isClosing ? "#2563EB" : "#1C2B50",
                          minHeight: "4px",
                        }}
                      />
                    </div>
                  )
                })}
              </div>
              {/* DRS threshold line */}
              <div
                className="absolute left-3 right-3 border-t border-dashed border-emerald-400/40"
                style={{ bottom: `${(1.0 / maxGap) * 100 * 0.72 + 8}%` }}
              >
                <span className="absolute -top-3 right-0 text-[9px] text-emerald-400/60 font-mono">DRS</span>
              </div>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-3 gap-3">
              <div className="flex flex-col items-center gap-1 px-3 py-3 rounded-xl bg-secondary/60 border border-border">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Gap</span>
                <span className="text-base font-mono font-bold text-foreground">{latest?.gap.toFixed(1) ?? "—"}s</span>
              </div>
              <div className="flex flex-col items-center gap-1 px-3 py-3 rounded-xl bg-secondary/60 border border-border">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Rate</span>
                <span className={`text-base font-mono font-bold ${(latest?.closingRate ?? 0) > 0 ? "text-emerald-400" : (latest?.closingRate ?? 0) < 0 ? "text-red-400" : "text-muted-foreground"}`}>
                  {latest ? `${latest.closingRate > 0 ? "+" : ""}${latest.closingRate.toFixed(2)}` : "—"}
                </span>
              </div>
              <div className="flex flex-col items-center gap-1 px-3 py-3 rounded-xl bg-secondary/60 border border-border">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">DRS</span>
                <span className={`text-base font-mono font-bold ${latest?.drsActive ? "text-emerald-400" : "text-muted-foreground"}`}>
                  {latest?.drsActive ? "ACTIVE" : "———"}
                </span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/* ---------- Zone 3: Overtake Log ---------- */
function OvertakeLog({ overtakes }: { overtakes: OvertakeEvent[] }) {
  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-border">
        <span className="text-xs font-mono text-[#2563EB] uppercase tracking-wider">Overtake Log</span>
        <span className="text-[10px] font-mono text-muted-foreground">{overtakes.length} events</span>
      </div>
      <div className="p-5">
        {overtakes.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">No overtakes detected yet</p>
        ) : (
          <div className="flex flex-col gap-2">
            {overtakes.map((ev) => (
              <div key={ev.id} className="flex items-start gap-3 px-4 py-3 rounded-xl bg-secondary/60 border border-border">
                <span className="px-2 py-0.5 rounded-md bg-[#2563EB]/10 text-[#2563EB] text-[10px] font-mono border border-[#2563EB]/20 flex-shrink-0">
                  L{ev.lap}
                </span>
                <p className="flex-1 text-xs text-foreground/90 leading-relaxed min-w-0">{ev.description}</p>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono uppercase tracking-wider flex-shrink-0 ${
                  ev.type === "ATTACKING"
                    ? "bg-emerald-400/10 text-emerald-400 border border-emerald-400/20"
                    : "bg-red-400/10 text-red-400 border border-red-400/20"
                }`}>
                  {ev.type === "ATTACKING" ? "ATK" : "DEF"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* ---------- Overtake Flash Banner ---------- */
function OvertakeFlash({ event }: { event: OvertakeEvent }) {
  const isAttack = event.type === "ATTACKING"
  return (
    <div className={`rounded-2xl border overflow-hidden animate-pulse ${
      isAttack
        ? "border-emerald-400/40 bg-emerald-400/10"
        : "border-red-400/40 bg-red-400/10"
    }`}>
      <div className="flex items-center gap-3 px-5 py-3">
        <span className="text-lg">⚡</span>
        <div className="flex-1 min-w-0">
          <span className={`text-[10px] font-mono uppercase tracking-wider ${isAttack ? "text-emerald-400" : "text-red-400"}`}>
            {isAttack ? "OVERTAKE" : "POSITION LOST"} — LAP {event.lap}
          </span>
          <p className="text-xs text-foreground/90 mt-0.5 truncate">{event.description}</p>
        </div>
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono uppercase tracking-wider flex-shrink-0 ${
          isAttack
            ? "bg-emerald-400/20 text-emerald-400 border border-emerald-400/30"
            : "bg-red-400/20 text-red-400 border border-red-400/30"
        }`}>
          {isAttack ? "ATK" : "DEF"}
        </span>
      </div>
    </div>
  )
}

/* ---------- Tension Header ---------- */
function TensionHeader({ isLive, onToggle, loading, analyzeRef }: { isLive: boolean; onToggle: () => void; loading: boolean; analyzeRef: React.RefObject<() => void> }) {
  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#2563EB]/10 flex items-center justify-center border border-[#2563EB]/20">
            <TrendingUp className="w-5 h-5 text-[#2563EB]" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground text-sm">Tension Tracker</h3>
            <p className="text-xs text-muted-foreground">Gap + Overtake Analysis</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => analyzeRef.current()}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#2563EB] text-white text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#2563EB]/90 transition-colors"
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <TrendingUp className="w-3 h-3" />}
            {loading ? "Analyzing..." : "Analyze"}
          </button>
          <button onClick={onToggle} className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${isLive ? "bg-emerald-400 animate-pulse" : "bg-muted-foreground"}`} />
            <span className={`text-xs font-mono ${isLive ? "text-emerald-400" : "text-muted-foreground"}`}>
              {isLive ? "LIVE" : "PAUSED"}
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}

/* ---------- Main TensionTracker ---------- */
function TensionTracker({ driver, driverName, driverNum, liveData }: LiveDataProps) {
  const [state, dispatch] = useReducer(tensionReducer, {
    bullets: [],
    gapHistory: [],
    overtakes: [],
    lastOvertake: null,
    loading: false,
    error: null,
  })
  const [isLive, setIsLive] = useState(true)
  const prevDriverRef = useRef(driver)

  // Reset on driver change
  useEffect(() => {
    if (prevDriverRef.current !== driver) {
      prevDriverRef.current = driver
      dispatch({ type: "RESET" })
    }
  }, [driver])

  // Process intervals from parent liveData into gap history + overtakes
  useEffect(() => {
    if (liveData.intervals.length > 0) {
      const recent = liveData.intervals.slice(-12)
      const { gaps, overtakes } = buildFromIntervals(recent, liveData.laps, driverNum)
      dispatch({ type: "INTERVALS_UPDATE", gaps, overtakes })
    }
  }, [liveData.intervals, liveData.laps, driverNum])

  // AI commentary — triggered manually via Analyze button
  const analyzeRef = useRef<() => void>(() => {})
  analyzeRef.current = () => {
    if (state.loading) return

    dispatch({ type: "FETCH_START" })

    const currentLap = liveData.currentLap
    const totalLaps = 58
    const lapsRemaining = totalLaps - currentLap

    const intervalSnippet = state.gapHistory.length > 0
      ? state.gapHistory.map((g) => `lap=${g.lap} gap=${g.gap.toFixed(2)}s closing=${g.closingRate.toFixed(2)}s/lap drs=${g.drsActive}`).join("; ")
      : "No interval data available."

    const prompt = `Analyze race tension for Williams driver ${driverName} #${driverNum}, lap ${currentLap}/${totalLaps} (${lapsRemaining} remaining).

Here is the latest interval data (already fetched, do NOT call the Get intervals tool):
${intervalSnippet}

Based on this data, provide 3-5 bullet-point commentary lines. Each bullet must be a complete sentence (15+ words) analyzing one of: gap trends, DRS proximity, overtake chances, defensive pressure, or strategy implications. Do NOT return single keywords or short phrases — write full analytical sentences.`

    fetch("/api/airia", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userInput: prompt, pipeline: "tension" }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          dispatch({ type: "FETCH_ERROR", error: data.error })
          return
        }

        const raw: string = data.result ?? data.output ?? data.response ?? (typeof data === "string" ? data : "")
        if (!raw) {
          dispatch({ type: "FETCH_ERROR", error: "Empty response from AI" })
          return
        }

        // Strip leading bullet markers but keep the sentence content
        const lines = raw.split("\n")
          .map((l: string) => l.replace(/^[\s\-\*•]+/, "").replace(/^\d+[.)]\s*/, "").trim())
          .filter((l: string) => l.length > 5)
        const bullets: CommentaryBullet[] = lines.map((text: string) => ({
          id: `b-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          text,
          tier: classifyTier(text),
          timestamp: Date.now(),
        }))

        dispatch({ type: "AI_SUCCESS", bullets })
      })
      .catch(() => {
        dispatch({ type: "FETCH_ERROR", error: "Failed to reach tension analysis" })
      })
  }

  const overtakeLaps = new Set(state.overtakes.map((o) => o.lap))
  const [flashEvent, setFlashEvent] = useState<OvertakeEvent | null>(null)

  // Show flash banner when a new overtake is detected
  useEffect(() => {
    if (!state.lastOvertake) return
    setFlashEvent(state.lastOvertake)
    const timer = setTimeout(() => setFlashEvent(null), 4000)
    return () => clearTimeout(timer)
  }, [state.lastOvertake])

  return (
    <div className="flex flex-col gap-4">
      <TensionHeader isLive={isLive} onToggle={() => setIsLive(!isLive)} loading={state.loading} analyzeRef={analyzeRef} />
      {flashEvent && <OvertakeFlash event={flashEvent} />}
      <CommentaryFeed bullets={state.bullets} loading={state.loading} />
      <GapVisualizer gapHistory={state.gapHistory} driverNum={driverNum} overtakeLaps={overtakeLaps} />
      <OvertakeLog overtakes={state.overtakes} />
    </div>
  )
}


// --- Telemetry Storyteller ---

interface CarDataReading {
  throttle: number
  brake: number
  speed: number
  rpm: number
  n_gear: number
  drs: number
}

interface TelemetryState {
  reading: CarDataReading | null
  gForce: number | null
  driverPos: DriverPosition | null
  narrative: string
  detail: string
  activeCorner: number | null
  loading: boolean
  error: string | null
}

function TelemetryStoryteller({ driver, driverName, driverNum, liveData }: LiveDataProps) {
  const [expanded, setExpanded] = useState(false)
  const [state, setState] = useState<TelemetryState>({
    reading: null,
    gForce: null,
    driverPos: null,
    narrative: "",
    detail: "",
    activeCorner: null,
    loading: false,
    error: null,
  })
  const [circuit, setCircuit] = useState<CircuitLayout | null>(null)
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
      setState({ reading: null, gForce: null, driverPos: null, narrative: "", detail: "", activeCorner: null, loading: false, error: null })
      setExpanded(false)
    }
  }, [driver])

  // Load circuit layout once (cached forever)
  useEffect(() => {
    let stale = false
    fetchCircuitLayout().then((layout) => {
      if (!stale && layout) setCircuit(layout)
    })
    return () => { stale = true }
  }, [])

  // Derive reading / gForce / driverPos from parent liveData
  useEffect(() => {
    const carData = liveData.carData
    const locData = liveData.location

    let reading: CarDataReading | null = null
    let gForce: number | null = null
    let driverPos: DriverPosition | null = null

    if (Array.isArray(carData) && carData.length > 0) {
      const latest = carData[carData.length - 1]
      reading = {
        throttle: latest.throttle ?? 0,
        brake: latest.brake ?? 0,
        speed: latest.speed ?? 0,
        rpm: latest.rpm ?? 0,
        n_gear: latest.n_gear ?? 0,
        drs: latest.drs ?? 0,
      }
      // Average g-force over last several samples to reduce noise
      if (carData.length >= 3) {
        const samples = carData.slice(-Math.min(carData.length, 8))
        let totalG = 0
        let count = 0
        for (let i = 1; i < samples.length; i++) {
          const dtMs = new Date(samples[i].date).getTime() - new Date(samples[i - 1].date).getTime()
          if (dtMs > 0 && dtMs < 2000) {
            const dvMs = ((samples[i].speed ?? 0) - (samples[i - 1].speed ?? 0)) / 3.6
            totalG += Math.abs(dvMs / (dtMs / 1000) / 9.81)
            count++
          }
        }
        if (count > 0) {
          gForce = Math.round((totalG / count) * 10) / 10
        }
      }
    }
    if (Array.isArray(locData) && locData.length > 0) {
      const latest = locData[locData.length - 1]
      if (latest.x != null && latest.y != null) {
        driverPos = { x: latest.x, y: latest.y }
      }
    }

    if (reading) {
      const nearest = driverPos && circuit ? findNearestCorner(driverPos, circuit.corners ?? []) : null
      const activeCorner = driverPos ? smoothCorner(nearest, circuit?.corners ?? [], driverPos) : nearest
      setState((prev) => ({ ...prev, reading, gForce, driverPos, activeCorner }))
    }
  }, [liveData.carData, liveData.location, circuit])

  // AI narrative — triggered manually via button
  const analyzeRef = useRef<() => void>(() => {})
  analyzeRef.current = () => {
    const r = state.reading
    if (!r || state.loading) return

    setState((prev) => ({ ...prev, loading: true }))

    const drsLabel = r.drs >= 10 ? "OPEN" : "CLOSED"
    const brakeLabel = r.brake >= 50 ? "ON (heavy braking)" : "OFF"
    const nearTurn = state.activeCorner ? `The driver is currently near Turn ${state.activeCorner}.` : ""
    const prompt = `You are a Formula 1 telemetry analyst for Williams Racing. Here is the latest car data for ${driverName} #${driverNum}:

Throttle: ${r.throttle}%, Brake: ${brakeLabel}, Speed: ${r.speed} km/h, RPM: ${r.rpm}, Gear: ${r.n_gear}, DRS: ${drsLabel}
${nearTurn}

Do NOT call any tools. Write exactly 2 paragraphs:
Paragraph 1: What the driver is doing right now at this point on the Yas Marina circuit. Reference the actual Turn number provided above.
Paragraph 2: Deeper technical detail about the car behavior and what this means for performance.`

    fetch("/api/airia", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userInput: prompt, pipeline: "telemetry" }),
    })
      .then((res) => res.json())
      .then((data: any) => {
        if (data.error) {
          setState((prev) => ({ ...prev, loading: false, error: data.error }))
          return
        }
        const raw: string = data.result ?? data.output ?? data.response ?? (typeof data === "string" ? data : "")
        if (!raw) {
          setState((prev) => ({ ...prev, loading: false, error: "Empty response from AI" }))
          return
        }
        const paragraphs = raw.split(/\n\n+/).map((p: string) => p.trim()).filter((p: string) => p.length > 20)
        const narrative = paragraphs[0] ?? raw
        const detail = paragraphs[1] ?? ""
        setState((prev) => ({ ...prev, narrative, detail, loading: false, error: null }))
      })
      .catch(() => {
        setState((prev) => ({ ...prev, loading: false, error: "Failed to reach telemetry analysis" }))
      })
  }

  const r = state.reading
  const drsOpen = r ? r.drs >= 10 : false
  const typedNarrative = useTypewriter(state.narrative)
  const typedDetail = useTypewriter(state.detail)

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#2563EB]/10 flex items-center justify-center border border-[#2563EB]/20">
            <Activity className="w-5 h-5 text-[#2563EB]" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground text-sm">Telemetry Stories</h3>
            <p className="text-xs text-muted-foreground">Car Data Explained</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {r ? (
            <span className="px-2.5 py-0.5 rounded-full bg-[#2563EB]/10 text-[#2563EB] text-xs font-mono border border-[#2563EB]/20">
              {r.speed} km/h
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="w-3 h-3 animate-spin" />
              Fetching data…
            </span>
          )}
          {state.loading && <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />}
        </div>
      </div>

      <div className="p-5">
        {/* Telemetry Gauges */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <GaugeCell label="Throttle" value={`${r?.throttle ?? 0}%`} percent={r?.throttle ?? 0} color="#22C55E" />
          <GaugeCell label="Brake" value={(r?.brake ?? 0) >= 50 ? "ON" : "OFF"} percent={r?.brake ?? 0} color="#FF4444" />
          <GaugeCell label="Speed" value={`${r?.speed ?? 0}`} unit="km/h" percent={((r?.speed ?? 0) / 350) * 100} color="#2563EB" />
        </div>

        <div className="grid grid-cols-4 gap-3 mb-4">
          <div className="flex flex-col items-center gap-1 px-2 py-3 rounded-xl bg-secondary/60 border border-border">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">RPM</span>
            <span className="text-sm font-mono font-bold text-foreground">{(r?.rpm ?? 0).toLocaleString()}</span>
          </div>
          <div className="flex flex-col items-center gap-1 px-2 py-3 rounded-xl bg-secondary/60 border border-border">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Gear</span>
            <span className="text-sm font-mono font-bold text-foreground">{r?.n_gear ?? 0}</span>
          </div>
          <div className="flex flex-col items-center gap-1 px-2 py-3 rounded-xl bg-secondary/60 border border-border">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">DRS</span>
            <span className={`text-sm font-mono font-bold ${drsOpen ? "text-emerald-400" : "text-muted-foreground"}`}>
              {drsOpen ? "OPEN" : "SHUT"}
            </span>
          </div>
          <div className="flex flex-col items-center gap-1 px-2 py-3 rounded-xl bg-secondary/60 border border-border">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">G-Force</span>
            <span className={`text-sm font-mono font-bold ${(state.gForce ?? 0) >= 3 ? "text-red-400" : (state.gForce ?? 0) >= 1.5 ? "text-amber-400" : "text-foreground"}`}>
              {state.gForce != null ? `${state.gForce}G` : "—"}
            </span>
          </div>
        </div>

        {/* Track Map */}
        <MiniTrackMap layout={circuit} activeCorner={state.activeCorner} driverPos={state.driverPos} />

        {/* Narrative */}
        <div className="rounded-xl bg-[#2563EB]/5 border border-[#2563EB]/15 p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono text-[#2563EB] uppercase tracking-wider">{"What's"} {driverName} Doing?</span>
            <button
              onClick={() => analyzeRef.current()}
              disabled={!r || state.loading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#2563EB] text-white text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#2563EB]/90 transition-colors"
            >
              {state.loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Activity className="w-3 h-3" />}
              {state.loading ? "Analyzing..." : "Analyze"}
            </button>
          </div>

          {state.error && (
            <p className="mt-2 text-xs text-red-400">{state.error}</p>
          )}

          {!state.narrative && !state.loading && !state.error && (
            <p className="mt-3 text-xs text-muted-foreground">Press Analyze to get AI commentary on the current telemetry.</p>
          )}

          {state.narrative && (
            <>
              <p className="mt-2 text-sm text-foreground/90 leading-relaxed">{typedNarrative}</p>

              {state.detail && (
                <>
                  <button
                    onClick={() => setExpanded(!expanded)}
                    className="flex items-center gap-1 mt-3 text-xs text-[#2563EB] hover:text-[#2563EB]/80 transition-colors"
                  >
                    {expanded ? "Less detail" : "More detail"}
                    {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </button>

                  {expanded && (
                    <p className="mt-3 pt-3 border-t border-[#2563EB]/10 text-sm text-foreground/80 leading-relaxed">
                      {typedDetail}
                    </p>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function GaugeCell({ label, value, unit, percent, color }: { label: string; value: string; unit?: string; percent: number; color: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-3 py-3 rounded-xl bg-secondary/60 border border-border">
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</span>
      <div className="relative w-full h-1.5 rounded-full bg-secondary">
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-700"
          style={{ width: `${Math.min(percent, 100)}%`, backgroundColor: color }}
        />
      </div>
      <div className="flex items-baseline gap-0.5">
        <span className="text-base font-mono font-bold text-foreground">{value}</span>
        {unit && <span className="text-[9px] text-muted-foreground">{unit}</span>}
      </div>
    </div>
  )
}


// --- Tyre Strategy Predictor ---

const COMPOUND_COLORS: Record<string, string> = {
  SOFT: "#FF4444",
  MEDIUM: "#FFD700",
  HARD: "#FFFFFF",
  INTERMEDIATE: "#22C55E",
  WET: "#2563EB",
}

interface TyreState {
  prediction: string
  loading: boolean
  error: string | null
}

function TyrePredictor({ driver, driverName, driverNum, liveData }: LiveDataProps) {
  const [state, setState] = useState<TyreState>({ prediction: "", loading: false, error: null })
  const prevDriverRef = useRef(driver)

  // Reset on driver change
  useEffect(() => {
    if (prevDriverRef.current !== driver) {
      prevDriverRef.current = driver
      setState({ prediction: "", loading: false, error: null })
    }
  }, [driver])

  const currentLap = liveData.currentLap
  const totalLaps = 58

  // Filter to only stints that have started within the sim time — drop future stints
  const startedStints = liveData.stints.filter((s) => s.lap_start <= currentLap)

  const classifiedStints = startedStints.map((s, i) => {
    const isActive = i === startedStints.length - 1 // last started stint is the current one
    const status: "active" | "completed" = isActive ? "active" : "completed"
    const tyreAge = isActive ? currentLap - s.lap_start + s.tyre_age_at_start : undefined
    return { ...s, status, tyreAge }
  })

  // Predict button — same pattern as telemetry Analyze
  const predictRef = useRef<() => void>(() => {})
  predictRef.current = () => {
    if (state.loading || liveData.stints.length === 0) return

    setState((prev) => ({ ...prev, loading: true, error: null }))

    const stintSummary = liveData.stints
      .map((s) => `Stint ${s.stint_number}: ${s.compound}, laps ${s.lap_start}-${s.lap_end || "?"}, tyre age at start: ${s.tyre_age_at_start}`)
      .join("\n")

    const activeStint = classifiedStints.find((s) => s.status === "active")
    const currentTyreAge = activeStint?.tyreAge ?? "unknown"

    const prompt = `You are a Formula 1 tyre strategy analyst for Williams Racing. Here is the stint data for ${driverName} #${driverNum}:

Current lap: ${currentLap}/${totalLaps} (${totalLaps - currentLap} laps remaining)

Stint history:
${stintSummary}

Current tyre age: ${currentTyreAge} laps on ${activeStint?.compound ?? "UNKNOWN"}

Provide a concise strategy analysis covering:
1. Pit stop prediction — when is the next pit stop likely?
2. Compound recommendation — what tyre should they switch to and why?
3. Overall strategy assessment — is this a good strategy? Any risks?

Do NOT call any tools. Write 2-3 short paragraphs.`

    fetch("/api/airia", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userInput: prompt, pipeline: "tyre" }),
    })
      .then((res) => res.json())
      .then((data: any) => {
        if (data.error) {
          setState((prev) => ({ ...prev, loading: false, error: data.error }))
          return
        }
        const raw: string = data.result ?? data.output ?? data.response ?? (typeof data === "string" ? data : "")
        if (!raw) {
          setState((prev) => ({ ...prev, loading: false, error: "Empty response from AI" }))
          return
        }
        setState((prev) => ({ ...prev, prediction: raw.trim(), loading: false, error: null }))
      })
      .catch(() => {
        setState((prev) => ({ ...prev, loading: false, error: "Failed to reach tyre strategy analysis" }))
      })
  }

  const typedPrediction = useTypewriter(state.prediction)

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#2563EB]/10 flex items-center justify-center border border-[#2563EB]/20">
            <CircleDot className="w-5 h-5 text-[#2563EB]" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground text-sm">Tyre Strategy</h3>
            <p className="text-xs text-muted-foreground">Live Stints + AI Prediction</p>
          </div>
        </div>
        <div className="px-3 py-1 rounded-full bg-secondary border border-border">
          <span className="text-xs font-mono text-muted-foreground">{liveData.stints.length} stint{liveData.stints.length !== 1 ? "s" : ""}</span>
        </div>
      </div>

      <div className="p-5">
        {/* Stint timeline */}
        <div className="flex flex-col gap-2 mb-4">
          {classifiedStints.length === 0 && (
            <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">Loading stint data…</div>
          )}
          {classifiedStints.map((stint) => {
            const color = COMPOUND_COLORS[stint.compound] ?? "#888888"
            const lapRange = stint.lap_end && stint.status === "completed"
              ? `${stint.lap_start}-${stint.lap_end}`
              : `${stint.lap_start}-?`
            const duration = stint.status === "completed" && stint.lap_end
              ? stint.lap_end - stint.lap_start + 1
              : currentLap - stint.lap_start + 1

            return (
              <div key={stint.stint_number} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-secondary/60 border border-border">
                {/* Pirelli-style tyre: dark rubber → compound band → dark hub */}
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ background: "#1a1a1a", boxShadow: "0 0 0 1.5px #333" }}
                >
                  <div
                    className="w-[18px] h-[18px] rounded-full flex items-center justify-center"
                    style={{ background: color }}
                  >
                    <div className="w-2 h-2 rounded-full" style={{ background: "#111" }} />
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-foreground">{stint.compound}</span>
                  {stint.tyreAge != null && (
                    <span className="ml-2 text-xs text-muted-foreground font-mono">{stint.tyreAge}L age</span>
                  )}
                </div>
                <span className="text-xs text-muted-foreground font-mono">{lapRange} ({duration}L)</span>
                <span
                  className={`text-[10px] uppercase tracking-wider font-mono px-2 py-0.5 rounded-full ${
                    stint.status === "active"
                      ? "bg-emerald-400/10 text-emerald-400 border border-emerald-400/20"
                      : "bg-secondary text-muted-foreground border border-border"
                  }`}
                >
                  {stint.status}
                </span>
              </div>
            )
          })}
        </div>

        {/* Prediction box */}
        <div className="rounded-xl bg-[#2563EB]/5 border border-[#2563EB]/15 p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono text-[#2563EB] uppercase tracking-wider">AI Prediction</span>
            <button
              onClick={() => predictRef.current()}
              disabled={liveData.stints.length === 0 || state.loading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#2563EB] text-white text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#2563EB]/90 transition-colors"
            >
              {state.loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <CircleDot className="w-3 h-3" />}
              {state.loading ? "Predicting..." : "Predict"}
            </button>
          </div>

          {state.error && (
            <p className="mt-2 text-xs text-red-400">{state.error}</p>
          )}

          {!state.prediction && !state.loading && !state.error && (
            <p className="mt-3 text-xs text-muted-foreground">Press Predict to get AI tyre strategy analysis.</p>
          )}

          {state.prediction && (
            <p className="mt-3 text-sm text-foreground/90 leading-relaxed whitespace-pre-line">{typedPrediction}</p>
          )}
        </div>
      </div>
    </div>
  )
}


// --- Main Dashboard ---

type TabId = "tension" | "telemetry" | "tyre"

export function HomeDashboard({ onBack }: HomeDashboardProps) {
  const [driver, setDriver] = useState<DriverId>("albon")
  const [activeTab, setActiveTab] = useState<TabId>("telemetry")
  const [sessionLabel, setSessionLabel] = useState("Session")
  const [liveData, setLiveData] = useState<LiveData>(LIVE_DATA_DEFAULTS)

  const driverName = driver === "albon" ? "Albon" : "Sainz"
  const driverNum = driver === "albon" ? "23" : "55"

  usePurpleSectorToasts()

  useEffect(() => {
    cachedFetch<any[]>(getSessionsUrl())
      .then((d) => setSessionLabel(sessionTypeToLabel(d[0]?.session_type ?? "")))
      .catch(() => {})
  }, [])

  // Tab-aware live data polling — only fetch endpoints the active tab needs
  useEffect(() => {
    let stale = false

    async function poll() {
      if (document.hidden) return
      // Debounce: skip if polled <200ms ago (blocks strict-mode double-mount, not tab switches)
      const sinceLast = Date.now() - _lastLiveDataFetchTime
      if (_lastLiveDataFetchTime > 0 && sinceLast < 200) return
      _lastLiveDataFetchTime = Date.now()

      const sk = getSessionKey()
      const simTime = simNow()
      // Round to nearest 5s so each poll gets a fresh cache key without hammering OpenF1
      const rounded = new Date(Math.floor(simTime.getTime() / 5_000) * 5_000)
      const simIso = rounded.toISOString()
      const tenSecAgo = new Date(rounded.getTime() - 10_000).toISOString()

      try {
        // Always fetch laps + position (needed across all tabs for header)
        const lapsP = cachedFetch<any[]>(`https://api.openf1.org/v1/laps?session_key=${sk}&driver_number=${driverNum}&date_start%3C=${encodeURIComponent(simIso)}`).catch(() => [])
        const positionP = cachedFetch<any[]>(`https://api.openf1.org/v1/position?session_key=${sk}&driver_number=${driverNum}&date%3C=${encodeURIComponent(simIso)}`).catch(() => [])

        // Only fetch what the active tab needs
        const intervalsP = activeTab === "tension"
          ? cachedFetch<any[]>(`https://api.openf1.org/v1/intervals?session_key=${sk}&driver_number=${driverNum}&date%3C=${encodeURIComponent(simIso)}`).catch(() => [])
          : Promise.resolve(null)

        const stintsP = activeTab === "tyre"
          ? cachedFetch<any[]>(`https://api.openf1.org/v1/stints?session_key=${sk}&driver_number=${driverNum}`).catch(() => [])
          : Promise.resolve(null)

        const carDataP = activeTab === "telemetry"
          ? cachedFetch<any[]>(`https://api.openf1.org/v1/car_data?session_key=${sk}&driver_number=${driverNum}&date%3C=${encodeURIComponent(simIso)}&date%3E=${encodeURIComponent(tenSecAgo)}`).catch(() => [])
          : Promise.resolve(null)

        const locationP = activeTab === "telemetry"
          ? cachedFetch<any[]>(`https://api.openf1.org/v1/location?session_key=${sk}&driver_number=${driverNum}&date%3C=${encodeURIComponent(simIso)}&date%3E=${encodeURIComponent(tenSecAgo)}`).catch(() => [])
          : Promise.resolve(null)

        const [laps, positionsArr, intervals, stints, carData, location] = await Promise.all([lapsP, positionP, intervalsP, stintsP, carDataP, locationP])

        if (stale) return

        // Derive currentLap from laps
        const t = simTime.getTime()
        let currentLap = getStartLap(30)
        const lapArr = Array.isArray(laps) ? laps : []
        for (const l of lapArr) {
          if (new Date(l.date_start).getTime() <= t) currentLap = l.lap_number
          else break
        }

        // Derive position from latest entry
        const posArr = Array.isArray(positionsArr) ? positionsArr : []
        const latestPos = posArr.length > 0 ? posArr[posArr.length - 1].position ?? null : null

        setLiveData((prev) => {
          const next = {
            ...prev,
            laps: Array.isArray(laps) ? laps.map((l: any) => ({ lap_number: l.lap_number, date_start: l.date_start })) : prev.laps,
            currentLap,
            position: latestPos ?? prev.position,
          }

          if (intervals != null) next.intervals = Array.isArray(intervals) ? intervals : []
          if (stints != null) {
            next.stints = Array.isArray(stints)
              ? stints.map((s: any) => ({
                  stint_number: s.stint_number,
                  lap_start: s.lap_start,
                  lap_end: s.lap_end,
                  compound: (s.compound ?? "UNKNOWN").toUpperCase(),
                  tyre_age_at_start: s.tyre_age_at_start ?? 0,
                }))
              : []
          }
          if (carData != null) next.carData = Array.isArray(carData) ? carData : []
          if (location != null) next.location = Array.isArray(location) ? location : []

          return next
        })
      } catch {
        // Non-critical — keep existing data
      }
    }

    poll()
    const pollInterval = activeTab === "telemetry" ? 5_000 : 60_000
    const timer = setInterval(poll, pollInterval)

    function onVisChange() {
      if (!document.hidden && !stale) poll()
    }
    document.addEventListener("visibilitychange", onVisChange)

    return () => {
      stale = true
      clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisChange)
    }
  }, [driver, driverNum, activeTab])

  // Reset live data + cooldown when driver changes
  useEffect(() => {
    setLiveData(LIVE_DATA_DEFAULTS)
    _lastLiveDataFetchTime = 0
  }, [driver])

  const tabs: { id: TabId; label: string; icon: typeof TrendingUp }[] = [
    { id: "telemetry", label: "Telemetry", icon: Activity },
    { id: "tension", label: "Tension", icon: TrendingUp },
    { id: "tyre", label: "Tyres", icon: CircleDot },
  ]

  const liveDataProps = { driver, driverName, driverNum, liveData }

  return (
    <div className="h-full min-h-dvh flex flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-background border-b border-border">
        <div className="flex items-center gap-3 px-5 pt-12 pb-3">
          <button
            onClick={onBack}
            className="p-2 -ml-2 rounded-lg hover:bg-secondary transition-colors"
            aria-label="Go back"
          >
            <ArrowLeft className="w-5 h-5 text-muted-foreground" />
          </button>
          <Image src="/Williams_F1_logo_2026.png" alt="Williams Racing" width={112} height={40} className="w-28 h-auto" />
          <div className="ml-auto flex flex-col items-end gap-1.5">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-full bg-[#7C3AED]/10 text-[#7C3AED] text-[10px] font-mono font-bold uppercase tracking-wider border border-[#7C3AED]/20">
                LAP {liveData.currentLap}
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-[#2563EB]/10 text-[#2563EB] text-[10px] font-mono uppercase tracking-wider border border-[#2563EB]/20">
                {sessionLabel}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {liveData.position != null && (
                <span className="px-2.5 py-0.5 rounded-full bg-emerald-400/10 text-emerald-400 text-[10px] font-mono font-bold uppercase tracking-wider border border-emerald-400/20">
                  POSITION {liveData.position}
                </span>
              )}
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#2563EB] animate-pulse" />
                <span className="text-[11px] text-[#2563EB] font-mono uppercase">At Home</span>
              </span>
            </div>
          </div>
        </div>
        <div className="px-5 pb-3">
          <DriverSelector selected={driver} onChange={setDriver} />
        </div>
        {/* Tab switcher */}
        <div className="px-5 pb-3">
          <div className="flex gap-1 p-1 rounded-xl bg-secondary/60 border border-border">
            {tabs.map((tab) => {
              const Icon = tab.icon
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                    activeTab === tab.id
                      ? "bg-card text-foreground border border-border shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      </header>

      {/* Content — keep all tabs mounted to preserve state across switches */}
      <main className="flex-1 px-5 py-4 pb-8">
        <div className={activeTab === "tension" ? "" : "hidden"}><TensionTracker {...liveDataProps} /></div>
        <div className={activeTab === "telemetry" ? "" : "hidden"}><TelemetryStoryteller {...liveDataProps} /></div>
        <div className={activeTab === "tyre" ? "" : "hidden"}><TyrePredictor {...liveDataProps} /></div>
      </main>
      <AskAiFab />
    </div>
  )
}
