"use client"

import { useState, useEffect } from "react"
import { ChevronRight } from "lucide-react"
import Image from "next/image"
import { getSessionsUrl, cachedFetch, sessionTypeToLabel } from "@/lib/simulation"

interface WelcomeScreenProps {
  onReady: () => void
}

export function WelcomeScreen({ onReady }: WelcomeScreenProps) {
  const [phase, setPhase] = useState<"loading" | "ready">("loading")
  const [sessionLabel, setSessionLabel] = useState("Race Day")

  useEffect(() => {
    const timer = setTimeout(() => setPhase("ready"), 2000)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    cachedFetch<any[]>(getSessionsUrl())
      .then((d) => setSessionLabel(sessionTypeToLabel(d[0]?.session_type ?? "")))
      .catch(() => {})
  }, [])

  return (
    <div className="h-full min-h-dvh flex flex-col items-center justify-center relative overflow-hidden px-6">
      {/* Animated background grid */}
      <div className="absolute inset-0 opacity-10">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(rgba(37,99,235,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(37,99,235,0.3) 1px, transparent 1px)",
            backgroundSize: "60px 60px",
          }}
        />
      </div>

      {/* Radial glow */}
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-[#2563EB]/5 blur-[120px]" />

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center gap-3 max-w-sm w-full">
        {/* Logo */}
        <div className={`transition-all duration-1000 ${phase === "loading" ? "opacity-0 translate-y-4" : "opacity-100 translate-y-0"}`}>
          <Image src="/Williams_F1_logo_2026.png" alt="Williams Racing" width={224} height={80} className="w-56 h-auto" priority />
        </div>
 
        {/* 2026 Car Hero */}
        <div className={`relative w-full transition-all h-2duration-1000 delay-300 ${phase === "loading" ? "opacity-0 scale-95" : "opacity-100 scale-100"}`}>
          <Image src="/williams-fw48-f1-car-formula-1-dashboard.png" alt="Williams FW48 2026" width={600} height={338} className="w-full h-auto" priority />
          <div className="h-4" />  
          {/* Driver portraits overlaid at the bottom */}
          <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 flex items-center gap-3">
            <div className="w-14 h-14 shrink-0 rounded-full overflow-hidden  shadow-lg shadow-black/40">
              <Image src="/albon.avif" alt="Alex Albon" width={56} height={56} className="w-full h-full object-cover" />
            </div>
            <div className="w-14 h-14 shrink-0 rounded-full overflow-hidden  shadow-lg shadow-black/40">
              <Image src="/sainz.avif" alt="Carlos Sainz" width={56} height={56} className="w-full h-full object-cover" />
            </div>
          </div>
        </div>

        {/* Spacer for overlapping portraits */}
        <div className="h-8" />

        {/* Title */}
        <div className={`text-center transition-all duration-1000 delay-700 ${phase === "loading" ? "opacity-0 translate-y-4" : "opacity-100 translate-y-0"}`}>
          <h1 className="text-3xl font-bold tracking-tight text-foreground text-balance">
            Williams AI Experience
          </h1>
          <p className="mt-3 text-muted-foreground text-sm leading-relaxed">
            Be a part of the crew, experience every pit stop, overtake, and strategy call.
          </p>
        </div>

        {/* CTA Button */}
        <button
          onClick={onReady}
          className={`group relative w-full overflow-hidden rounded-xl px-6 py-4 font-semibold text-base text-white active:scale-[0.98] transition-transform duration-500 delay-[900ms] ${phase === "loading" ? "opacity-0 translate-y-4" : "opacity-100 translate-y-0"}`}
        >
          {/* Animated gradient background */}
          <div
            className="absolute inset-0 animate-[shimmer_3s_linear_infinite]"
            style={{
              background: "linear-gradient(110deg, #2563EB 0%, #7C3AED 25%, #2563EB 50%, #7C3AED 75%, #2563EB 100%)",
              backgroundSize: "250% 100%",
            }}
          />
          {/* Sweeping light streak */}
          <div className="absolute inset-0 animate-[streak_2.5s_ease-in-out_infinite]"
            style={{
              background: "linear-gradient(110deg, transparent 30%, rgba(255,255,255,0.15) 45%, rgba(255,255,255,0.25) 50%, rgba(255,255,255,0.15) 55%, transparent 70%)",
              backgroundSize: "200% 100%",
            }}
          />
          {/* Glow on hover */}
          <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-white/10" />
          {/* Content */}
          <span className="relative z-10 flex items-center justify-center gap-3">
            <ChevronRight className="w-5 h-5 opacity-0" aria-hidden />
            <span>Ready for {sessionLabel}</span>
            <ChevronRight className="w-5 h-5 transition-transform group-hover:translate-x-1" />
          </span>
        </button>

        {/* Powered by line */}
        <p className={`text-xs text-muted-foreground/50 font-mono uppercase tracking-widest transition-all duration-1000 delay-[1100ms] ${phase === "loading" ? "opacity-0" : "opacity-100"}`}>
          Powered by Katana1 on Airia
        </p>
      </div>
    </div>
  )
}
