"use client"

import { useState, useEffect, useRef } from "react"
import { ArrowLeft, Zap, Radio, CloudRain, MapPin, Loader2 } from "lucide-react"
import Image from "next/image"
import { DriverSelector, type DriverId } from "./driver-selector"
import { fetchPitData, type PitData } from "@/lib/openf1"
import { getMeetingKey, getSessionKey, getStartLap, getSessionsUrl, cachedFetch, sessionTypeToLabel, now as simNow } from "@/lib/simulation"
import { TeamRadioCard } from "./team-radio"
import { LivePositionCard } from "./live-position"
import { AskAiFab } from "./ask-ai"
import { usePurpleSectorToasts } from "@/hooks/use-purple-sector-toasts"

interface VenueDashboardProps {
  onBack: () => void
}

// --- Pit Strategy Explainer ---

const TYRE_COLORS: Record<string, string> = {
  SOFT: "#EF4444",
  MEDIUM: "#FFD700",
  HARD: "#FFFFFF",
  INTERMEDIATE: "#22C55E",
  WET: "#3B82F6",
}

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

// Cache the in-flight promise so strict-mode remount reuses it (1 call, not 2)
const _fetchCache = new Map<string, Promise<PitData>>()

function doFetch(driver: DriverId): Promise<PitData> {
  const num = driver === "albon" ? 23 : 55
  return fetchPitData(num)
}

function PitStrategyCard({ driver }: { driver: DriverId }) {
  const [pitData, setPitData] = useState<PitData | null>(null)
  const [strategy, setStrategy] = useState<string | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [phase, setPhase] = useState<"loading" | "leaving" | "done">("loading")
  const [pitTime, setPitTime] = useState("0.00")
  const pitTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const driverName = driver === "albon" ? "Albon" : "Sainz"
  const driverNum = driver === "albon" ? 23 : 55

  const typedStrategy = useTypewriter(strategy ?? "")

  // Animate pit time counting up from 0 to actual duration
  const animatePitTime = (target: number) => {
    if (pitTimerRef.current) clearInterval(pitTimerRef.current)
    const duration = 800
    const start = Date.now()
    setPitTime("0.00")
    pitTimerRef.current = setInterval(() => {
      const progress = Math.min((Date.now() - start) / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setPitTime((eased * target).toFixed(2))
      if (progress >= 1) clearInterval(pitTimerRef.current!)
    }, 30)
  }

  // AI analysis — triggered manually via Analyze button
  const analyzeRef = useRef<() => void>(() => {})
  analyzeRef.current = () => {
    if (aiLoading) return

    setAiLoading(true)
    setAiError(null)

    const meetingKey = getMeetingKey()
    const sessionKey = getSessionKey()
    const currentLap = getStartLap(30)
    const simTime = process.env.NEXT_PUBLIC_SIM_TIME ?? new Date().toISOString()

    const pitContext = pitData
      ? `Last pit: ${pitData.lastPitLap != null ? `Lap ${pitData.lastPitLap}` : "None"}, Tyre: ${pitData.compound} (${pitData.tyreAge} laps old), Position: ${pitData.position != null ? `P${pitData.position}` : "N/A"}, Gap to leader: ${pitData.gapToLeader}, Weather: ${pitData.weather}`
      : ""

    fetch("/api/airia", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userInput: `Analyze pit strategy for driver ${driverName} #${driverNum}. Meeting key: ${meetingKey}, Session key: ${sessionKey}, current lap: ${currentLap}, current time: ${simTime}. ${pitContext}`,
        pipeline: "pit",
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setAiError(data.error)
          setAiLoading(false)
          return
        }
        const text = data.result ?? data.output ?? data.response ?? (typeof data === "string" ? data : null)
        setStrategy(text ?? "Strategy analysis unavailable.")
        setAiLoading(false)
      })
      .catch(() => {
        setAiError("Failed to reach strategy analysis")
        setAiLoading(false)
      })
  }

  useEffect(() => {
    let stale = false
    const startTime = Date.now()
    const MIN_PIT_MS = 1500

    setPhase("loading")
    setPitData(null)
    setStrategy(null)
    setAiLoading(false)
    setAiError(null)
    setPitTime("0.00")

    // Reuse in-flight promise if one already exists for this driver
    if (!_fetchCache.has(driver)) {
      _fetchCache.set(driver, doFetch(driver))
    }

    _fetchCache.get(driver)!.then(async (result) => {
      // Clear cache after resolving so next mount fetches fresh data
      setTimeout(() => _fetchCache.delete(driver), 2_000)

      if (stale) return

      // Ensure pit stop animation plays for at least MIN_PIT_MS
      const elapsed = Date.now() - startTime
      if (elapsed < MIN_PIT_MS) {
        await new Promise(r => setTimeout(r, MIN_PIT_MS - elapsed))
      }
      if (stale) return

      setPitData(result)
      // Animate pit time count-up to actual duration
      const dur = result.pitDuration
      if (dur != null) animatePitTime(dur)

      // Let the count-up animation finish (800ms), then car drives out
      await new Promise(r => setTimeout(r, 850))
      if (stale) return

      setPhase("leaving")
      setTimeout(() => {
        if (!stale) setPhase("done")
      }, 900)
    }).catch(() => {
      // Clear failed cache entry so retries work
      _fetchCache.delete(driver)
      if (!stale) setPhase("done")
    })

    return () => {
      stale = true
      if (pitTimerRef.current) clearInterval(pitTimerRef.current)
    }
  }, [driver])

  // Silent background refresh every 30s once animation is done
  useEffect(() => {
    if (phase !== "done") return
    let stale = false
    const timer = setInterval(() => {
      if (stale) return
      fetchPitData(driverNum).then((result) => {
        if (!stale) setPitData(result)
      }).catch(() => {})
    }, 30_000)
    return () => { stale = true; clearInterval(timer) }
  }, [phase, driverNum])

  const tyreColor = pitData ? (TYRE_COLORS[pitData.compound] ?? "#888888") : "#888888"

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#2563EB]/10 flex items-center justify-center border border-[#2563EB]/20">
            <Zap className="w-5 h-5 text-[#2563EB]" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground text-sm">Pit Strategy</h3>
            <p className="text-xs text-muted-foreground">AI-Analyzed</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs text-emerald-400 font-mono">LIVE</span>
        </div>
      </div>

      {/* Pit Data Grid */}
      <div className="p-5 flex-1 overflow-y-auto scrollbar-hide" style={{ scrollbarWidth: "none", WebkitOverflowScrolling: "touch" }}>
        {phase !== "done" ? (
          <div className="flex flex-col items-center justify-center py-8 gap-4">
            {/* Pit stop animation */}
            <div className="relative w-48 h-24 overflow-hidden">
              {/* Pit lane surface */}
              <div className="absolute bottom-2 left-0 right-0 h-[2px] bg-border" />
              <div className="absolute bottom-1 left-0 right-0 flex justify-between px-4">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="w-4 h-[1px] bg-muted-foreground/30" />
                ))}
              </div>

              {/* Car */}
              <div
                key={phase}
                className={`absolute bottom-4 ${
                  phase === "loading"
                    ? "animate-[pitCarIn_1.2s_ease-out_forwards]"
                    : "animate-[pitCarOut_0.8s_ease-in_forwards]"
                }`}
                style={{ left: phase === "leaving" ? "62px" : "-60px" }}
              >
                <div className="relative">
                  <div className="absolute -left-1 top-0 w-[3px] h-3 bg-[#2563EB] rounded-sm" />
                  <div className="w-14 h-3 bg-gradient-to-r from-[#2563EB] to-[#2563EB]/80 rounded-r-full rounded-l-sm" />
                  <div className="absolute right-[-6px] top-[3px] w-3 h-[6px] bg-[#2563EB]/60 rounded-r-full" />
                  <div className="absolute left-4 -top-1 w-3 h-2 bg-[#060A18] rounded-t-md" />
                  <div className="absolute -right-1 -bottom-1.5 w-3 h-3 rounded-full bg-[#1a1a1a] border border-[#333] animate-[wheelSpin_0.3s_linear_infinite] flex items-center justify-center">
                    <div className="w-1 h-1 rounded-full bg-[#333]" />
                  </div>
                  <div className="absolute left-1 -bottom-1.5 w-3 h-3 rounded-full bg-[#1a1a1a] border border-[#333] animate-[wheelSpin_0.3s_linear_infinite] flex items-center justify-center">
                    <div className="w-1 h-1 rounded-full bg-[#333]" />
                  </div>
                </div>
              </div>

              {/* Sparks + crew + tyre — only during loading phase */}
              {phase === "loading" && (
                <>
                  <div className="absolute bottom-6 left-[52%] animate-[fadeInOut_0.6s_ease-in-out_1.4s_infinite]">
                    <div className="flex gap-0.5">
                      <div className="w-1 h-1 rounded-full bg-amber-400" />
                      <div className="w-0.5 h-0.5 rounded-full bg-amber-300 mt-0.5" />
                      <div className="w-1 h-1 rounded-full bg-amber-400" />
                    </div>
                  </div>
                  <div className="absolute bottom-6 left-[30%] animate-[fadeInOut_0.6s_ease-in-out_1.7s_infinite]">
                    <div className="flex gap-0.5">
                      <div className="w-1 h-1 rounded-full bg-amber-400" />
                      <div className="w-0.5 h-0.5 rounded-full bg-amber-300 mt-0.5" />
                      <div className="w-1 h-1 rounded-full bg-amber-400" />
                    </div>
                  </div>
                  <div className="absolute bottom-3 left-[26%] animate-[crewAppear_0.3s_ease-out_1.2s_both]">
                    <div className="w-2 h-5 bg-muted-foreground/40 rounded-t-full" />
                  </div>
                  <div className="absolute bottom-3 left-[48%] animate-[crewAppear_0.3s_ease-out_1.3s_both]">
                    <div className="w-2 h-5 bg-muted-foreground/40 rounded-t-full" />
                  </div>
                  <div className="absolute bottom-3 left-[56%] animate-[crewAppear_0.3s_ease-out_1.35s_both]">
                    <div className="w-2 h-4 bg-muted-foreground/30 rounded-t-full" />
                  </div>
                  <div className="absolute bottom-8 left-[60%] animate-[tyreOff_0.8s_ease-out_1.8s_both]">
                    <div className="w-4 h-4 rounded-full bg-[#1a1a1a] border-2 border-[#EF4444] flex items-center justify-center">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#111]" />
                    </div>
                  </div>
                </>
              )}

              {/* Green light flash when leaving */}
              {phase === "leaving" && (
                <div className="absolute top-1 right-2 flex gap-1 animate-[fadeInOut_0.4s_ease-in-out_forwards]">
                  <div className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(34,197,94,0.8)]" />
                  <div className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(34,197,94,0.8)]" />
                  <div className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(34,197,94,0.8)]" />
                </div>
              )}
            </div>

            {/* Pit timer */}
            <div className="font-mono tabular-nums text-center">
              <span className="text-2xl font-bold text-foreground">{pitTime}</span>
              <span className="text-xs text-muted-foreground ml-1">s</span>
            </div>

            {/* Text below */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground font-mono">
                {phase === "leaving" ? "GO GO GO" : "BOX BOX"}
              </span>
              {phase === "loading" && (
                <span className="text-sm text-muted-foreground font-mono animate-[blink_1s_step-end_infinite]">|</span>
              )}
            </div>
            <span className="text-xs text-muted-foreground/60 font-mono">
              {phase === "leaving" ? `Data ready for #${driverNum}` : `Fetching #${driverNum} ${driverName}`}
            </span>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <DataCell label="Last Pit" value={pitData?.lastPitLap != null ? `Lap ${pitData.lastPitLap}` : "N/A"} />
              <DataCell label="Tyre Age" value={pitData ? `${pitData.tyreAge} laps` : "N/A"} />
              <DataCell label="Position" value={pitData?.position != null ? `P${pitData.position}` : "N/A"} highlight />
              <DataCell label="Gap to Leader" value={pitData?.gapToLeader ?? "N/A"} />
            </div>

            {/* Current tyre */}
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-secondary/60 border border-border mb-4">
              {/* Mini tyre: dark rubber → compound band → dark hub */}
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center"
                style={{ background: "#1a1a1a", boxShadow: "0 0 0 1.5px #333" }}
              >
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center"
                  style={{ background: tyreColor }}
                >
                  <div className="w-3 h-3 rounded-full" style={{ background: "#111" }} />
                </div>
              </div>
              <span className="text-sm font-medium text-foreground">{pitData?.compound ?? "UNKNOWN"}</span>
              <div className="flex items-center gap-1 ml-auto">
                <CloudRain className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">{pitData?.weather ?? "N/A"}</span>
              </div>
            </div>

            {/* AI Strategy Explanation */}
            <div className="rounded-xl bg-[#2563EB]/5 border border-[#2563EB]/15 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-mono text-[#2563EB] uppercase tracking-wider">AI Analysis</span>
                <button
                  onClick={() => analyzeRef.current()}
                  disabled={aiLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#2563EB] text-white text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#2563EB]/90 transition-colors"
                >
                  {aiLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                  {aiLoading ? "Analyzing..." : "Analyze"}
                </button>
              </div>

              {aiError && (
                <p className="mt-2 text-xs text-red-400">{aiError}</p>
              )}

              {!strategy && !aiLoading && !aiError && (
                <p className="text-xs text-muted-foreground">Press Analyze to get AI pit strategy commentary.</p>
              )}

              {strategy && (
                <p className="text-sm text-foreground/90 leading-relaxed">{typedStrategy}</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function DataCell({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex flex-col gap-1 px-4 py-3 rounded-xl bg-secondary/60 border border-border">
      <span className="text-[11px] text-muted-foreground uppercase tracking-wider">{label}</span>
      <span className={`text-lg font-mono font-bold ${highlight ? "text-[#2563EB]" : "text-foreground"}`}>
        {value}
      </span>
    </div>
  )
}


// --- Main Dashboard ---

function useSessionLabel(): string {
  const [label, setLabel] = useState("Session")
  useEffect(() => {
    cachedFetch<any[]>(getSessionsUrl())
      .then((d) => setLabel(sessionTypeToLabel(d[0]?.session_type ?? "")))
      .catch(() => {})
  }, [])
  return label
}

function useCurrentLap(driverNum: number): number {
  const [currentLap, setCurrentLap] = useState(getStartLap(30))
  useEffect(() => {
    let stale = false
    function poll() {
      const sk = getSessionKey()
      const simTime = simNow()
      const simIso = simTime.toISOString()
      cachedFetch<{ lap_number: number; date_start: string }[]>(
        `https://api.openf1.org/v1/laps?session_key=${sk}&driver_number=${driverNum}&date_start%3C=${encodeURIComponent(simIso)}`
      )
        .then((laps) => {
          if (stale || !Array.isArray(laps)) return
          const t = simTime.getTime()
          let lap = getStartLap(30)
          for (const l of laps) {
            if (new Date(l.date_start).getTime() <= t) lap = l.lap_number
            else break
          }
          setCurrentLap(lap)
        })
        .catch(() => {})
    }
    poll()
    const timer = setInterval(poll, 30_000)
    return () => { stale = true; clearInterval(timer) }
  }, [driverNum])
  return currentLap
}

function usePosition(driverNum: number): number | null {
  const [position, setPosition] = useState<number | null>(null)
  useEffect(() => {
    setPosition(null)
    let stale = false
    function poll() {
      const sk = getSessionKey()
      const simIso = simNow().toISOString()
      cachedFetch<{ position: number; date: string }[]>(
        `https://api.openf1.org/v1/position?session_key=${sk}&driver_number=${driverNum}&date%3C=${encodeURIComponent(simIso)}`
      )
        .then((positions) => {
          if (stale || !Array.isArray(positions) || positions.length === 0) return
          setPosition(positions[positions.length - 1].position)
        })
        .catch(() => {})
    }
    poll()
    const timer = setInterval(poll, 30_000)
    return () => { stale = true; clearInterval(timer) }
  }, [driverNum])
  return position
}

export function VenueDashboard({ onBack }: VenueDashboardProps) {
  const [driver, setDriver] = useState<DriverId>("albon")
  const [activeTab, setActiveTab] = useState<"track" | "pit" | "radio">("track")
  const sessionLabel = useSessionLabel()
  const driverNum = driver === "albon" ? 23 : 55
  const currentLap = useCurrentLap(driverNum)
  const position = usePosition(driverNum)

  usePurpleSectorToasts()

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
                LAP {currentLap}
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-[#2563EB]/10 text-[#2563EB] text-[10px] font-mono uppercase tracking-wider border border-[#2563EB]/20">
                {sessionLabel}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {position != null && (
                <span className="px-2.5 py-0.5 rounded-full bg-emerald-400/10 text-emerald-400 text-[10px] font-mono font-bold uppercase tracking-wider border border-emerald-400/20">
                  POSITION {position}
                </span>
              )}
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-[11px] text-emerald-400 font-mono uppercase">At Circuit</span>
              </span>
            </div>
          </div>
        </div>
        <div className="px-5 pb-3">
          <DriverSelector selected={driver} onChange={setDriver} />
        </div>
      </header>

      {/* Tab switcher */}
      <div className="px-5 pt-4">
        <div className="flex gap-1 p-1 rounded-xl bg-secondary/60 border border-border">
          {([
            { id: "track" as const, label: "Track", Icon: MapPin },
            { id: "pit" as const, label: "Pit Strategy", Icon: Zap },
            { id: "radio" as const, label: "Team Radio", Icon: Radio },
          ]).map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                activeTab === id
                  ? "bg-card text-foreground border border-border shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <main className="flex-1 min-h-0 px-5 py-4 flex flex-col">
        {activeTab === "pit" && <PitStrategyCard driver={driver} />}
        {activeTab === "radio" && <TeamRadioCard driver={driver} />}
        {activeTab === "track" && <LivePositionCard driver={driver} />}
      </main>
      <AskAiFab />
    </div>
  )
}
