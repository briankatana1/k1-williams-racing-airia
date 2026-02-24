"use client"

import { useState, useEffect, useCallback } from "react"
import { ArrowLeft, TrendingUp, Activity, CircleDot, ChevronDown, ChevronUp } from "lucide-react"
import Image from "next/image"
import { DriverSelector, type DriverId } from "./driver-selector"
import { getStartLap, getSessionsUrl, cachedFetch, sessionTypeToLabel } from "@/lib/simulation"

interface HomeDashboardProps {
  onBack: () => void
}

// --- Live Tension Tracker ---

function TensionTracker({ driver }: { driver: DriverId }) {
  const [lapData, setLapData] = useState<{ lap: number; gap: number }[]>([])
  const [narrative, setNarrative] = useState("")
  const [isLive, setIsLive] = useState(true)

  const driverName = driver === "albon" ? "Albon" : "Sainz"
  const driverNum = driver === "albon" ? "23" : "55"
  const rivalName = driver === "albon" ? "Stroll" : "Gasly"

  const generateNarrative = useCallback((data: { lap: number; gap: number }[]) => {
    if (data.length < 3) return "Gathering lap data..."
    const recent = data.slice(-3)
    const trend = recent[2].gap - recent[0].gap
    const currentGap = recent[2].gap

    if (trend < -0.4) {
      const lapsToPass = Math.ceil(currentGap / (Math.abs(trend) / 3))
      return `${driverName} is closing ${Math.abs(trend).toFixed(1)}s over the last 3 laps on ${rivalName}. Gap now ${currentGap.toFixed(1)}s — a pass could happen in ${lapsToPass} laps if this pace continues.`
    } else if (trend < -0.1) {
      return `${driverName} is slowly reeling in ${rivalName}. The gap is ${currentGap.toFixed(1)}s and shrinking — expect DRS range within 5-6 laps.`
    } else if (trend > 0.3) {
      return `${rivalName} has picked up the pace. The gap to ${driverName} has grown to ${currentGap.toFixed(1)}s. The team may consider an alternate strategy to recover.`
    } else {
      return `${driverName} and ${rivalName} are locked in a tense battle. Gap holding steady at ${currentGap.toFixed(1)}s — neither driver giving an inch.`
    }
  }, [driverName, rivalName])

  useEffect(() => {
    setLapData([])
    const startLap = getStartLap(24)
    const initialData = Array.from({ length: 8 }, (_, i) => ({
      lap: startLap + i,
      gap: 2.8 - i * 0.25 + (Math.random() * 0.3 - 0.15),
    }))
    setLapData(initialData)
    setNarrative(generateNarrative(initialData))
  }, [driver, generateNarrative])

  useEffect(() => {
    if (!isLive) return
    const interval = setInterval(() => {
      setLapData((prev) => {
        const lastLap = prev.length > 0 ? prev[prev.length - 1].lap : 31
        const lastGap = prev.length > 0 ? prev[prev.length - 1].gap : 1.0
        const newGap = Math.max(0.1, lastGap - 0.2 + (Math.random() * 0.35 - 0.1))
        const newData = [...prev.slice(-11), { lap: lastLap + 1, gap: newGap }]
        setNarrative(generateNarrative(newData))
        return newData
      })
    }, 4000)
    return () => clearInterval(interval)
  }, [isLive, driver, generateNarrative])

  const maxGap = Math.max(...lapData.map((d) => d.gap), 3)

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#2563EB]/10 flex items-center justify-center border border-[#2563EB]/20">
            <TrendingUp className="w-5 h-5 text-[#2563EB]" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground text-sm">Tension Tracker</h3>
            <p className="text-xs text-muted-foreground">Gap + Overtake Analysis</p>
          </div>
        </div>
        <button
          onClick={() => setIsLive(!isLive)}
          className="flex items-center gap-2"
        >
          <span className={`w-2 h-2 rounded-full ${isLive ? "bg-emerald-400 animate-pulse" : "bg-muted-foreground"}`} />
          <span className={`text-xs font-mono ${isLive ? "text-emerald-400" : "text-muted-foreground"}`}>
            {isLive ? "LIVE" : "PAUSED"}
          </span>
        </button>
      </div>

      <div className="p-5">
        {/* Mini chart */}
        <div className="relative h-28 mb-4 rounded-xl bg-secondary/40 border border-border p-3 overflow-hidden">
          <div className="absolute top-2 left-3 text-[10px] text-muted-foreground font-mono">
            GAP TO {rivalName.toUpperCase()} (s)
          </div>
          <div className="absolute bottom-2 right-3 text-[10px] text-muted-foreground font-mono">
            #{driverNum}
          </div>
          {/* Chart bars */}
          <div className="flex items-end gap-1 h-full pt-4 pb-1">
            {lapData.map((d, i) => {
              const height = (d.gap / maxGap) * 100
              const isClosing = i > 0 && d.gap < lapData[i - 1].gap
              return (
                <div
                  key={`${driver}-${d.lap}`}
                  className="flex-1 rounded-t transition-all duration-500"
                  style={{
                    height: `${height}%`,
                    backgroundColor: isClosing ? "#2563EB" : "#1C2B50",
                    minHeight: "4px",
                  }}
                />
              )
            })}
          </div>
          {/* DRS zone line */}
          <div
            className="absolute left-3 right-3 border-t border-dashed border-emerald-400/40"
            style={{ bottom: `${(1.0 / maxGap) * 100 * 0.72 + 8}%` }}
          >
            <span className="absolute -top-3 right-0 text-[9px] text-emerald-400/60 font-mono">DRS</span>
          </div>
        </div>

        {/* Narrative */}
        <div className="rounded-xl bg-[#2563EB]/5 border border-[#2563EB]/15 p-4">
          <span className="text-xs font-mono text-[#2563EB] uppercase tracking-wider">AI Narrative</span>
          <p className="mt-2 text-sm text-foreground/90 leading-relaxed">{narrative}</p>
        </div>
      </div>
    </div>
  )
}


// --- Telemetry Storyteller ---

function TelemetryStoryteller({ driver }: { driver: DriverId }) {
  const [expanded, setExpanded] = useState(false)

  const driverName = driver === "albon" ? "Albon" : "Sainz"

  const telemetry = driver === "albon"
    ? {
        throttle: 87,
        brake: 12,
        speed: 298,
        rpm: 11200,
        drs: true,
        gear: 8,
        story: "Albon is absolutely flat out through the main straight — 87% throttle, DRS wide open, hitting 298 km/h. That is like going from London to Edinburgh in about an hour. The DRS flap on the rear wing is open, reducing drag and giving him an extra 10-15 km/h advantage on the car ahead.",
        detail: "His braking is incredibly late into Turn 1 — just 12% brake pressure at this point means he is still carrying enormous speed. The engine is screaming at 11,200 RPM in 8th gear. Every fraction of a second counts here.",
      }
    : {
        throttle: 42,
        brake: 78,
        speed: 124,
        rpm: 8800,
        drs: false,
        gear: 3,
        story: "Sainz is in the heavy braking zone — 78% brake force as he scrubs off speed from 310 km/h. That is like stopping a bullet train. He has downshifted to 3rd gear, the engine acting as a brake too. The car is pulling nearly 5G under braking — his neck is holding the weight of a small child.",
        detail: "With DRS closed in the braking zone, the rear wing is providing maximum downforce for stability. At 42% throttle, Sainz is already preparing to get back on the power for the corner exit. Incredibly precise driving.",
      }

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
      </div>

      <div className="p-5">
        {/* Telemetry Gauges */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <GaugeCell label="Throttle" value={`${telemetry.throttle}%`} percent={telemetry.throttle} color="#22C55E" />
          <GaugeCell label="Brake" value={`${telemetry.brake}%`} percent={telemetry.brake} color="#FF4444" />
          <GaugeCell label="Speed" value={`${telemetry.speed}`} unit="km/h" percent={(telemetry.speed / 350) * 100} color="#2563EB" />
        </div>

        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="flex flex-col items-center gap-1 px-3 py-3 rounded-xl bg-secondary/60 border border-border">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">RPM</span>
            <span className="text-base font-mono font-bold text-foreground">{telemetry.rpm.toLocaleString()}</span>
          </div>
          <div className="flex flex-col items-center gap-1 px-3 py-3 rounded-xl bg-secondary/60 border border-border">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Gear</span>
            <span className="text-base font-mono font-bold text-foreground">{telemetry.gear}</span>
          </div>
          <div className="flex flex-col items-center gap-1 px-3 py-3 rounded-xl bg-secondary/60 border border-border">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">DRS</span>
            <span className={`text-base font-mono font-bold ${telemetry.drs ? "text-emerald-400" : "text-muted-foreground"}`}>
              {telemetry.drs ? "OPEN" : "SHUT"}
            </span>
          </div>
        </div>

        {/* Story */}
        <div className="rounded-xl bg-[#2563EB]/5 border border-[#2563EB]/15 p-4">
          <span className="text-xs font-mono text-[#2563EB] uppercase tracking-wider">{"What's"} {driverName} Doing?</span>
          <p className="mt-2 text-sm text-foreground/90 leading-relaxed">{telemetry.story}</p>
          
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 mt-3 text-xs text-[#2563EB] hover:text-[#2563EB]/80 transition-colors"
          >
            {expanded ? "Less detail" : "More detail"}
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>

          {expanded && (
            <p className="mt-3 pt-3 border-t border-[#2563EB]/10 text-sm text-foreground/80 leading-relaxed">
              {telemetry.detail}
            </p>
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

function TyrePredictor({ driver }: { driver: DriverId }) {
  const driverName = driver === "albon" ? "Albon" : "Sainz"

  const stints = driver === "albon"
    ? [
        { compound: "HARD", color: "#FFFFFF", laps: "1-18", status: "completed" as const },
        { compound: "MEDIUM", color: "#FFD700", laps: "19-?", status: "active" as const },
        { compound: "SOFT", color: "#FF4444", laps: "Predicted", status: "predicted" as const },
      ]
    : [
        { compound: "MEDIUM", color: "#FFD700", laps: "1-21", status: "completed" as const },
        { compound: "HARD", color: "#FFFFFF", laps: "22-?", status: "active" as const },
      ]

  const prediction = driver === "albon"
    ? {
        nextPit: "Lap 38-42",
        confidence: 72,
        strategy: "Two-stop",
        explanation: "Based on current tyre degradation rates and Albon's pace on MEDIUMs, the AI predicts a pit window around Lap 38-42. A switch to SOFTs for a sprint finish would give him fresher rubber for the final 15 laps — potentially gaining 2 positions.",
      }
    : {
        nextPit: "No stop predicted",
        confidence: 65,
        strategy: "One-stop",
        explanation: "Sainz's HARD tyres are holding up well. Current degradation suggests he can make it to the end on a one-stop strategy. However, if the gap to the car behind closes below 2 seconds, a late defensive stop for SOFTs could be triggered.",
      }

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#2563EB]/10 flex items-center justify-center border border-[#2563EB]/20">
            <CircleDot className="w-5 h-5 text-[#2563EB]" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground text-sm">Tyre Strategy</h3>
            <p className="text-xs text-muted-foreground">Predict + Explain</p>
          </div>
        </div>
        <div className="px-3 py-1 rounded-full bg-secondary border border-border">
          <span className="text-xs font-mono text-muted-foreground">{prediction.strategy}</span>
        </div>
      </div>

      <div className="p-5">
        {/* Stint timeline */}
        <div className="flex flex-col gap-2 mb-4">
          {stints.map((stint, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-secondary/60 border border-border">
              <div
                className="w-5 h-5 rounded-full border-2 flex-shrink-0"
                style={{
                  borderColor: stint.color,
                  backgroundColor: stint.status === "predicted" ? "transparent" : `${stint.color}20`,
                }}
              >
                {stint.status === "predicted" && (
                  <div className="w-full h-full rounded-full border border-dashed" style={{ borderColor: stint.color }} />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium text-foreground">{stint.compound}</span>
              </div>
              <span className="text-xs text-muted-foreground font-mono">{stint.laps}</span>
              <span
                className={`text-[10px] uppercase tracking-wider font-mono px-2 py-0.5 rounded-full ${
                  stint.status === "active"
                    ? "bg-emerald-400/10 text-emerald-400 border border-emerald-400/20"
                    : stint.status === "completed"
                      ? "bg-secondary text-muted-foreground border border-border"
                      : "bg-[#2563EB]/10 text-[#2563EB] border border-[#2563EB]/20"
                }`}
              >
                {stint.status}
              </span>
            </div>
          ))}
        </div>

        {/* Prediction box */}
        <div className="rounded-xl bg-[#2563EB]/5 border border-[#2563EB]/15 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-mono text-[#2563EB] uppercase tracking-wider">AI Prediction</span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Confidence</span>
              <div className="w-12 h-1.5 rounded-full bg-secondary overflow-hidden">
                <div
                  className="h-full rounded-full bg-[#2563EB] transition-all"
                  style={{ width: `${prediction.confidence}%` }}
                />
              </div>
              <span className="text-xs font-mono text-[#2563EB]">{prediction.confidence}%</span>
            </div>
          </div>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-lg font-mono font-bold text-foreground">{prediction.nextPit}</span>
          </div>
          <p className="text-sm text-foreground/90 leading-relaxed">{prediction.explanation}</p>
        </div>
      </div>
    </div>
  )
}


// --- Main Dashboard ---

type TabId = "tension" | "telemetry" | "tyre"

export function HomeDashboard({ onBack }: HomeDashboardProps) {
  const [driver, setDriver] = useState<DriverId>("albon")
  const [activeTab, setActiveTab] = useState<TabId>("tension")
  const [sessionLabel, setSessionLabel] = useState("Session")

  useEffect(() => {
    cachedFetch<any[]>(getSessionsUrl())
      .then((d) => setSessionLabel(sessionTypeToLabel(d[0]?.session_type ?? "")))
      .catch(() => {})
  }, [])

  const tabs: { id: TabId; label: string; icon: typeof TrendingUp }[] = [
    { id: "tension", label: "Tension", icon: TrendingUp },
    { id: "telemetry", label: "Telemetry", icon: Activity },
    { id: "tyre", label: "Tyres", icon: CircleDot },
  ]

  return (
    <div className="h-full min-h-dvh flex flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-background/80 backdrop-blur-xl border-b border-border">
        <div className="flex items-center gap-3 px-5 pt-12 pb-3">
          <button
            onClick={onBack}
            className="p-2 -ml-2 rounded-lg hover:bg-secondary transition-colors"
            aria-label="Go back"
          >
            <ArrowLeft className="w-5 h-5 text-muted-foreground" />
          </button>
          <Image src="/Williams_F1_logo_2026.png" alt="Williams Racing" width={112} height={40} className="w-28 h-auto" />
          <div className="ml-auto flex items-center gap-3">
            <span className="px-2.5 py-0.5 rounded-full bg-[#2563EB]/10 text-[#2563EB] text-[10px] font-mono uppercase tracking-wider border border-[#2563EB]/20">
              {sessionLabel}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#2563EB] animate-pulse" />
              <span className="text-[11px] text-[#2563EB] font-mono uppercase">At Home</span>
            </span>
          </div>
        </div>
        <div className="px-5 pb-3">
          <DriverSelector selected={driver} onChange={setDriver} />
        </div>
      </header>

      {/* Tab switcher */}
      <div className="px-5 pt-4">
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

      {/* Content */}
      <main className="flex-1 px-5 py-4 pb-8">
        {activeTab === "tension" && <TensionTracker driver={driver} />}
        {activeTab === "telemetry" && <TelemetryStoryteller driver={driver} />}
        {activeTab === "tyre" && <TyrePredictor driver={driver} />}
      </main>
    </div>
  )
}
