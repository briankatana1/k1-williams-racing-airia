"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { ArrowLeft, ArrowRight, Clock, MapPinned, Calendar } from "lucide-react"
import Image from "next/image"
import { getMeetingsUrl, getSessionsUrl, cachedFetch, now } from "@/lib/simulation"

interface LocationSelectProps {
  onContinue: () => void
  onBack: () => void
}

interface SessionData {
  session_name: string
  session_type: string
  circuit_short_name: string
  country_name: string
  country_code: string
  date_start: string
  date_end: string
  year: number
  location: string
}

interface MeetingData {
  meeting_name: string
  meeting_official_name: string
  circuit_image: string
  country_flag: string
  circuit_short_name: string
  country_name: string
  country_code: string
  gmt_offset: string
  date_start: string
  date_end: string
  year: number
}

const COUNTRY_CODE_MAP: Record<string, string> = {
  BRN: "BH", KSA: "SA", AUS: "AU", JPN: "JP", CHN: "CN",
  USA: "US", ITA: "IT", MON: "MC", ESP: "ES", CAN: "CA",
  AUT: "AT", GBR: "GB", HUN: "HU", BEL: "BE", NED: "NL",
  SGP: "SG", AZE: "AZ", MEX: "MX", BRA: "BR", QAT: "QA",
  ARE: "AE", POR: "PT", TUR: "TR", FRA: "FR", RSA: "ZA",
}

const STREET_CIRCUITS = new Set([
  "Monaco", "Singapore", "Baku", "Jeddah", "Las Vegas", "Melbourne",
  "Miami", "Montreal",
])

function countryCodeToFlag(code: string): string {
  const iso2 = COUNTRY_CODE_MAP[code.toUpperCase()] ?? code.slice(0, 2).toUpperCase()
  const codePoints = iso2
    .split("")
    .map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)
  return String.fromCodePoint(...codePoints)
}

function getSessionStatus(dateStart: string, dateEnd: string): "live" | "upcoming" | "finished" {
  const n = now()
  const start = new Date(dateStart)
  const end = new Date(dateEnd)
  if (n >= start && n <= end) return "live"
  if (n < start) return "upcoming"
  return "finished"
}

function getCircuitLocalTime(gmtOffset: string): string {
  const match = gmtOffset.match(/^(-?)(\d{2}):(\d{2})/)
  if (!match) return "--:--"
  const sign = match[1] === "-" ? -1 : 1
  const hours = parseInt(match[2], 10)
  const minutes = parseInt(match[3], 10)
  const offsetMs = sign * (hours * 60 + minutes) * 60_000
  const n = now()
  const utcNow = n.getTime() + n.getTimezoneOffset() * 60_000
  const localTime = new Date(utcNow + offsetMs)
  return localTime.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
}

function formatDateRange(start: string, end: string): string {
  const s = new Date(start)
  const e = new Date(end)
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }
  return `${s.toLocaleDateString(undefined, opts)} - ${e.toLocaleDateString(undefined, opts)}`
}

function getCircuitType(circuitName: string): string {
  return STREET_CIRCUITS.has(circuitName) ? "Street Circuit" : "Permanent Circuit"
}

/** Strip standalone "Formula 1" / "FORMULA 1" branding from API strings. */
function stripF1Branding(text: string): string {
  return text.replace(/\bformula\s*1\b\s*/gi, "").trim()
}

const MAX_TILT = 12

// ---------- CircuitCard ----------

function CircuitCard({
  meeting,
  session,
  status,
}: {
  meeting: MeetingData
  session: SessionData | null
  status: "live" | "upcoming" | "finished" | null
}) {
  const [rotateX, setRotateX] = useState(0)
  const [rotateY, setRotateY] = useState(0)
  const [isInteracting, setIsInteracting] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const pointerActive = useRef(false)
  const orientationEnabled = useRef(false)

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const card = cardRef.current
    if (!card) return
    const rect = card.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const centerX = rect.width / 2
    const centerY = rect.height / 2
    const rY = ((x - centerX) / centerX) * MAX_TILT
    const rX = ((centerY - y) / centerY) * MAX_TILT
    pointerActive.current = true
    setIsInteracting(true)
    setRotateX(rX)
    setRotateY(rY)
  }, [])

  const handlePointerLeave = useCallback(() => {
    pointerActive.current = false
    setIsInteracting(false)
    setRotateX(0)
    setRotateY(0)
  }, [])

  // Device orientation for mobile tilt
  useEffect(() => {
    const handler = (e: DeviceOrientationEvent) => {
      if (pointerActive.current) return
      const beta = e.beta ?? 0   // front-back tilt
      const gamma = e.gamma ?? 0 // left-right tilt
      const rX = Math.max(-MAX_TILT, Math.min(MAX_TILT, beta * 0.3))
      const rY = Math.max(-MAX_TILT, Math.min(MAX_TILT, gamma * 0.3))
      orientationEnabled.current = true
      setRotateX(rX)
      setRotateY(rY)
    }

    const requestPermission = async () => {
      const DOE = DeviceOrientationEvent as unknown as {
        requestPermission?: () => Promise<string>
      }
      if (typeof DOE.requestPermission === "function") {
        try {
          const perm = await DOE.requestPermission()
          if (perm === "granted") {
            window.addEventListener("deviceorientation", handler)
          }
        } catch {
          // Permission denied or unavailable
        }
      } else {
        window.addEventListener("deviceorientation", handler)
      }
    }

    // On iOS we need a user gesture to request permission — attach to first tap on the card
    const card = cardRef.current
    const onTap = () => {
      requestPermission()
      card?.removeEventListener("touchstart", onTap)
    }
    card?.addEventListener("touchstart", onTap, { once: true })

    // On non-iOS, try immediately
    const DOE = DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<string>
    }
    if (typeof DOE.requestPermission !== "function") {
      window.addEventListener("deviceorientation", handler)
    }

    return () => {
      window.removeEventListener("deviceorientation", handler)
      card?.removeEventListener("touchstart", onTap)
    }
  }, [])

  // Derive glare position from tilt (50% = center)
  const glareX = 50 + (rotateY / MAX_TILT) * 30
  const glareY = 50 - (rotateX / MAX_TILT) * 30

  return (
    <div className="mx-4" style={{ perspective: "800px" }}>
      <div
        ref={cardRef}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        onPointerUp={handlePointerLeave}
        className="relative rounded-3xl backdrop-blur-xl border border-white/[0.08] shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)]"
        style={{
          background: "rgba(255,255,255,0.04)",
          transform: `rotateX(${rotateX}deg) rotateY(${rotateY}deg)`,
          transformStyle: "preserve-3d",
          willChange: "transform",
          transition: isInteracting ? "transform 0s" : "transform 0.4s cubic-bezier(0.22, 1, 0.36, 1)",
          touchAction: "none",
        }}
      >
        {/* Glare overlay */}
        <div
          className="absolute inset-0 z-20 pointer-events-none rounded-3xl"
          style={{
            background: `radial-gradient(circle at ${glareX}% ${glareY}%, rgba(255,255,255,0.12) 0%, transparent 60%)`,
          }}
        />

        {/* Card content */}
        <div className="relative z-10 p-5">
          {/* Track image */}
          {meeting.circuit_image && (
            <div className="relative w-full aspect-[16/10] rounded-2xl overflow-hidden bg-white/[0.03] border border-white/[0.06]">
              <Image
                src={meeting.circuit_image}
                alt={`${meeting.circuit_short_name} track layout`}
                fill
                className="object-contain p-4"
                sizes="(max-width: 768px) 100vw, 600px"
              />
              <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[#2563EB]/15 to-transparent pointer-events-none" />
            </div>
          )}

          {/* Country row */}
          <div className="flex items-center gap-3 mt-5">
            {meeting.country_flag ? (
              <Image
                src={meeting.country_flag}
                alt={meeting.country_name}
                width={36}
                height={26}
                className="h-[26px] w-auto rounded-sm"
              />
            ) : (
              <span className="text-2xl">{countryCodeToFlag(meeting.country_code)}</span>
            )}
            <h2 className="text-xl font-bold text-foreground tracking-tight">
              {meeting.country_name}
            </h2>
            <span className="text-muted-foreground text-sm font-medium">/ {meeting.circuit_short_name}</span>
          </div>

          {/* Official name + year badge */}
          <div className="flex items-center gap-2 mt-1.5">
            <p className="text-sm text-muted-foreground truncate">
              {stripF1Branding(meeting.meeting_official_name)}
            </p>
            <span className="flex-shrink-0 px-2 py-0.5 rounded bg-[#2563EB]/10 text-[#2563EB] text-xs font-mono border border-[#2563EB]/20">
              {meeting.year}
            </span>
          </div>

          {/* Divider */}
          <div className="border-t border-white/[0.06] my-5" />

          {/* Session info */}
          {session && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="text-sm font-medium text-foreground">
                {session.session_type} &mdash; {session.session_name}
              </span>
              <span className="text-xs text-muted-foreground font-mono">
                {new Date(session.date_start).toLocaleString(undefined, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
              {status === "live" && (
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-500/10 border border-red-500/20">
                  <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-xs text-red-400 font-mono font-semibold">LIVE</span>
                </span>
              )}
              {status === "upcoming" && (
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-400/10 border border-amber-400/20">
                  <span className="inline-block w-2 h-2 rounded-full bg-amber-400" />
                  <span className="text-xs text-amber-400 font-mono font-semibold">UPCOMING</span>
                </span>
              )}
              {status === "finished" && (
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted border border-border">
                  <span className="text-xs text-muted-foreground font-mono">FINISHED</span>
                </span>
              )}
            </div>
          )}

          {/* Quick facts row */}
          <div className="flex flex-wrap gap-2.5 mt-5">
            <div className="flex items-center gap-1.5 px-3 py-2.5 rounded-full bg-white/[0.06] border border-white/[0.08]">
              <Clock className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
              <span className="text-xs font-mono text-foreground whitespace-nowrap">
                {getCircuitLocalTime(meeting.gmt_offset)}
              </span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-2.5 rounded-full bg-white/[0.06] border border-white/[0.08]">
              <MapPinned className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
              <span className="text-xs font-mono text-foreground whitespace-nowrap">
                {getCircuitType(meeting.circuit_short_name)}
              </span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-2.5 rounded-full bg-white/[0.06] border border-white/[0.08]">
              <Calendar className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
              <span className="text-xs font-mono text-foreground whitespace-nowrap">
                {formatDateRange(meeting.date_start, meeting.date_end)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------- Skeleton ----------

function HeroSkeleton() {
  return (
    <div className="mx-4">
      <div
        className="relative rounded-3xl overflow-hidden backdrop-blur-xl border border-white/[0.08] shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)] animate-pulse"
        style={{ background: "rgba(255,255,255,0.04)" }}
      >
        <div className="p-5">
          <div className="w-full aspect-[16/10] rounded-2xl bg-muted" />
          <div className="flex items-center gap-3 mt-4">
            <div className="w-8 h-6 rounded bg-muted" />
            <div className="h-5 w-40 rounded bg-muted" />
          </div>
          <div className="h-4 w-56 rounded bg-muted mt-2" />
          <div className="border-t border-white/[0.06] my-4" />
          <div className="flex items-center gap-3">
            <div className="h-4 w-32 rounded bg-muted" />
            <div className="h-4 w-24 rounded bg-muted" />
            <div className="h-5 w-20 rounded-full bg-muted" />
          </div>
          <div className="flex gap-2.5 mt-4">
            <div className="h-9 flex-1 rounded-full bg-muted" />
            <div className="h-9 flex-1 rounded-full bg-muted" />
            <div className="h-9 flex-1 rounded-full bg-muted" />
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------- Component ----------

export function LocationSelect({ onContinue, onBack }: LocationSelectProps) {
  const [session, setSession] = useState<SessionData | null>(null)
  const [meeting, setMeeting] = useState<MeetingData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.allSettled([
      cachedFetch<MeetingData[]>(getMeetingsUrl()).then((d) => d[0] ?? null),
      cachedFetch<SessionData[]>(getSessionsUrl()).then((d) => d[0] ?? null),
    ]).then(([meetingResult, sessionResult]) => {
      if (meetingResult.status === "fulfilled" && meetingResult.value) {
        setMeeting(meetingResult.value)
      }
      if (sessionResult.status === "fulfilled" && sessionResult.value) {
        setSession(sessionResult.value)
      }
      setLoading(false)
    })
  }, [])

  const status = session ? getSessionStatus(session.date_start, session.date_end) : null

  return (
    <div className="h-full min-h-dvh flex flex-col relative overflow-x-hidden">
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

      {/* Card / Skeleton — vertically centered */}
      <div className="relative z-10 flex-1 flex flex-col justify-center">
        {!loading && meeting && (
          <div className="mx-4 mb-4">
            <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
              {status === "live" ? "Live Now" : status === "upcoming" ? "Up Next" : "Latest Event"}
            </p>
            <h1 className="text-2xl font-bold text-foreground tracking-tight mt-1">
              {stripF1Branding(meeting.meeting_name)}
            </h1>
          </div>
        )}
        {loading && <HeroSkeleton />}
        {!loading && meeting && (
          <CircuitCard meeting={meeting} session={session} status={status} />
        )}
      </div>

      {/* Continue CTA */}
      <div className="relative z-10 pb-10">
        {!loading && (
          <div className="mx-4 mt-8">
            <button
              onClick={onContinue}
              className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-[#2563EB] text-white font-semibold text-base transition-all hover:bg-[#2563EB]/90 active:scale-[0.98]"
            >
              Continue
              <ArrowRight className="w-5 h-5" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
