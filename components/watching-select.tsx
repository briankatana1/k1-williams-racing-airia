"use client"

import { useState, useEffect } from "react"
import { MapPin, Tv, ArrowLeft, Zap, BarChart3 } from "lucide-react"
import Image from "next/image"
import { getSessionsUrl, cachedFetch, now } from "@/lib/simulation"

export type LocationType = "venue" | "home"

interface WatchingSelectProps {
  onSelect: (location: LocationType) => void
  onBack: () => void
}

interface SessionInfo {
  session_type: string
  session_name: string
  date_start: string
  date_end: string
}

type Occasion = {
  label: string
  color: string       // tailwind text color
  bg: string           // tailwind bg
  border: string       // tailwind border
  dot: string          // tailwind dot color
  pulse: boolean
}

function getSessionStatus(dateStart: string, dateEnd: string): "live" | "upcoming" | "finished" {
  const n = now()
  const start = new Date(dateStart)
  const end = new Date(dateEnd)
  if (n >= start && n <= end) return "live"
  const msUntilStart = start.getTime() - n.getTime()
  if (msUntilStart > 0 && msUntilStart <= 24 * 60 * 60 * 1000) return "upcoming"
  return "finished"
}

function deriveOccasion(session: SessionInfo | null): Occasion {
  if (!session) {
    return {
      label: "RACE WEEKEND",
      color: "text-muted-foreground",
      bg: "bg-muted",
      border: "border-border",
      dot: "bg-muted-foreground",
      pulse: false,
    }
  }

  const status = getSessionStatus(session.date_start, session.date_end)
  const type = session.session_type.toLowerCase()

  if (status === "live") {
    if (type.includes("race") && !type.includes("sprint")) {
      return { label: "RACE DAY — LIVE", color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/20", dot: "bg-red-500", pulse: true }
    }
    if (type.includes("sprint")) {
      return { label: "SPRINT — LIVE", color: "text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/20", dot: "bg-orange-500", pulse: true }
    }
    if (type.includes("qualifying")) {
      return { label: "QUALIFYING — LIVE", color: "text-purple-400", bg: "bg-purple-500/10", border: "border-purple-500/20", dot: "bg-purple-500", pulse: true }
    }
    if (type.includes("practice")) {
      return { label: "PRACTICE — LIVE", color: "text-cyan-400", bg: "bg-cyan-500/10", border: "border-cyan-500/20", dot: "bg-cyan-500", pulse: true }
    }
    return { label: "SESSION — LIVE", color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/20", dot: "bg-red-500", pulse: true }
  }

  if (status === "upcoming") {
    if (type.includes("race") && !type.includes("sprint")) {
      return { label: "RACE DAY", color: "text-amber-400", bg: "bg-amber-400/10", border: "border-amber-400/20", dot: "bg-amber-400", pulse: false }
    }
    if (type.includes("sprint")) {
      return { label: "SPRINT DAY", color: "text-orange-400", bg: "bg-orange-400/10", border: "border-orange-400/20", dot: "bg-orange-400", pulse: false }
    }
    if (type.includes("qualifying")) {
      return { label: "QUALIFYING DAY", color: "text-purple-400", bg: "bg-purple-400/10", border: "border-purple-400/20", dot: "bg-purple-400", pulse: false }
    }
    if (type.includes("practice")) {
      return { label: "PRACTICE DAY", color: "text-cyan-400", bg: "bg-cyan-400/10", border: "border-cyan-400/20", dot: "bg-cyan-400", pulse: false }
    }
    return { label: "RACE WEEKEND", color: "text-amber-400", bg: "bg-amber-400/10", border: "border-amber-400/20", dot: "bg-amber-400", pulse: false }
  }

  // finished
  return {
    label: "RACE WEEKEND",
    color: "text-muted-foreground",
    bg: "bg-muted",
    border: "border-border",
    dot: "bg-muted-foreground",
    pulse: false,
  }
}

export function WatchingSelect({ onSelect, onBack }: WatchingSelectProps) {
  const [session, setSession] = useState<SessionInfo | null>(null)

  useEffect(() => {
    cachedFetch<SessionInfo[]>(getSessionsUrl())
      .then((d) => setSession(d[0] ?? null))
      .catch(() => {})
  }, [])

  const occasion = deriveOccasion(session)

  return (
    <div className="h-full min-h-dvh flex flex-col relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[500px] h-[400px] rounded-full bg-[#2563EB]/5 blur-[100px]" />

      {/* Header */}
      <header className="sticky top-0 z-20 flex items-center gap-3 px-5 pt-12 pb-3 bg-background/80 backdrop-blur-xl">
        <button
          onClick={onBack}
          className="p-2 -ml-2 rounded-lg hover:bg-secondary transition-colors"
          aria-label="Go back"
        >
          <ArrowLeft className="w-5 h-5 text-muted-foreground" />
        </button>
        <Image src="/Williams_F1_logo_2026.png" alt="Williams Racing" width={128} height={46} className="w-32 h-auto" />
      </header>

      {/* Content */}
      <div className="relative z-10 flex-1 flex flex-col px-4 pt-4 pb-12">
        <div className="w-full">
          {/* Occasion badge */}
          <div className="mb-4">
            <span className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-mono font-semibold ${occasion.bg} ${occasion.border} border`}>
              <span className={`inline-block w-2 h-2 rounded-full ${occasion.dot} ${occasion.pulse ? "animate-pulse" : ""}`} />
              <span className={occasion.color}>{occasion.label}</span>
            </span>
          </div>

          <h2 className="text-2xl font-bold text-foreground tracking-tight text-balance">
            Where are you watching?
          </h2>
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
            We&apos;ll tailor your AI companion to match your{" "}
            {session?.session_type.toLowerCase().includes("race") && !session?.session_type.toLowerCase().includes("sprint")
              ? "race day"
              : session?.session_type.toLowerCase().includes("sprint")
                ? "sprint session"
                : session?.session_type.toLowerCase().includes("qualifying")
                  ? "qualifying session"
                  : session?.session_type.toLowerCase().includes("practice")
                    ? "practice session"
                    : "race weekend"}.
          </p>

          <div className="mt-8 flex flex-col gap-4">
            {/* At the Venue */}
            <button
              onClick={() => onSelect("venue")}
              className="group relative w-full text-left rounded-3xl backdrop-blur-xl border border-white/[0.08] shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)] transition-all active:scale-[0.98] hover:border-[#2563EB]/30 overflow-hidden"
              style={{ background: "rgba(255,255,255,0.04)" }}
            >
              {/* Hover glow */}
              <div className="absolute inset-0 bg-gradient-to-br from-[#2563EB]/8 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

              <div className="relative p-5">
                <div className="flex items-center gap-4">
                  <div className="flex-shrink-0 w-14 h-14 rounded-2xl bg-gradient-to-br from-[#2563EB]/20 to-[#2563EB]/5 flex items-center justify-center border border-[#2563EB]/20">
                    <MapPin className="w-6 h-6 text-[#2563EB]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-foreground text-lg tracking-tight">At the Circuit</h3>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      Trackside AI with live race context
                    </p>
                  </div>
                </div>

                {/* Feature pills */}
                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.06] border border-white/[0.08] text-xs text-muted-foreground font-mono">
                    <Zap className="w-3 h-3 text-emerald-400" />
                    Pit Strategy
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.06] border border-white/[0.08] text-xs text-muted-foreground font-mono">
                    <Zap className="w-3 h-3 text-emerald-400" />
                    Voice Assistant
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.06] border border-white/[0.08] text-xs text-muted-foreground font-mono">
                    <Zap className="w-3 h-3 text-emerald-400" />
                    Live Questions
                  </span>
                </div>

                {/* Status bar */}
                <div className="mt-4 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-xs text-emerald-400 font-mono font-semibold">LIVE FEATURES</span>
                  </div>
                  <span className="text-xs text-muted-foreground font-mono">Select &rarr;</span>
                </div>
              </div>
            </button>

            {/* At Home */}
            <button
              onClick={() => onSelect("home")}
              className="group relative w-full text-left rounded-3xl backdrop-blur-xl border border-white/[0.08] shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)] transition-all active:scale-[0.98] hover:border-[#2563EB]/30 overflow-hidden"
              style={{ background: "rgba(255,255,255,0.04)" }}
            >
              {/* Hover glow */}
              <div className="absolute inset-0 bg-gradient-to-br from-[#2563EB]/8 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

              <div className="relative p-5">
                <div className="flex items-center gap-4">
                  <div className="flex-shrink-0 w-14 h-14 rounded-2xl bg-gradient-to-br from-[#2563EB]/20 to-[#2563EB]/5 flex items-center justify-center border border-[#2563EB]/20">
                    <Tv className="w-6 h-6 text-[#2563EB]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-foreground text-lg tracking-tight">Watching from Home</h3>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      Deep analysis and race storytelling
                    </p>
                  </div>
                </div>

                {/* Feature pills */}
                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.06] border border-white/[0.08] text-xs text-muted-foreground font-mono">
                    <BarChart3 className="w-3 h-3 text-[#2563EB]" />
                    Tension Tracker
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.06] border border-white/[0.08] text-xs text-muted-foreground font-mono">
                    <BarChart3 className="w-3 h-3 text-[#2563EB]" />
                    Telemetry Stories
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.06] border border-white/[0.08] text-xs text-muted-foreground font-mono">
                    <BarChart3 className="w-3 h-3 text-[#2563EB]" />
                    Tyre Predictions
                  </span>
                </div>

                {/* Status bar */}
                <div className="mt-4 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="inline-block w-2 h-2 rounded-full bg-[#2563EB] animate-pulse" />
                    <span className="text-xs text-[#2563EB] font-mono font-semibold">FULL ANALYSIS</span>
                  </div>
                  <span className="text-xs text-muted-foreground font-mono">Select &rarr;</span>
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
