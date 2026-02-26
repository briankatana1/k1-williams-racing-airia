"use client"

import { useState, useEffect, useRef } from "react"
import { Radio, Play, Pause, Loader2, FileText } from "lucide-react"
import { getMeetingKey, getSessionKey, cachedFetch, sessionTypeToLabel, now as simNow } from "@/lib/simulation"
import type { DriverId } from "./driver-selector"

interface RadioClip {
  date: string
  driver_number: number
  meeting_key: number
  recording_url: string
  session_key: number
}

interface LapEntry {
  lap_number: number
  date_start: string
}

interface SessionInfo {
  session_key: number
  session_type: string
  session_name: string
}

function formatTime(isoDate: string): string {
  try {
    const d = new Date(isoDate)
    return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
  } catch {
    return "--:--:--"
  }
}

function clipToLap(clipDate: string, laps: LapEntry[]): number | null {
  if (!laps.length) return null
  const t = new Date(clipDate).getTime()
  let best: number | null = null
  for (const l of laps) {
    if (new Date(l.date_start).getTime() <= t) best = l.lap_number
    else break
  }
  return best
}

/** Short label for a session type, e.g. "Practice 1" → "FP1" */
function shortSessionLabel(sessionType: string, sessionName: string): string {
  const t = sessionType.toLowerCase()
  if (t.includes("race") && !t.includes("sprint")) return "Race"
  if (t.includes("sprint")) return "Sprint"
  if (t.includes("qualifying")) return "Quali"
  // Practice — use session_name to distinguish FP1/FP2/FP3
  if (t.includes("practice")) {
    const match = sessionName.match(/(\d)/)
    return match ? `FP${match[1]}` : "FP"
  }
  return sessionTypeToLabel(sessionType)
}

/** Reveals text word-by-word with a rolling-up effect. */
function RollingTranscript({ text }: { text: string }) {
  const words = text.split(/\s+/)
  const [visibleCount, setVisibleCount] = useState(0)
  const containerRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    setVisibleCount(0)
  }, [text])

  useEffect(() => {
    if (visibleCount >= words.length) return
    const timer = setTimeout(() => {
      setVisibleCount((c) => c + 1)
      // Scroll to bottom as words appear
      if (containerRef.current) {
        containerRef.current.scrollTop = containerRef.current.scrollHeight
      }
    }, 60)
    return () => clearTimeout(timer)
  }, [visibleCount, words.length])

  return (
    <p
      ref={containerRef}
      className="text-xs italic text-muted-foreground leading-relaxed pl-12 max-h-20 overflow-y-auto scrollbar-hide"
      style={{ scrollbarWidth: "none" }}
    >
      &ldquo;
      {words.map((word, i) => (
        <span
          key={i}
          className={`inline-block transition-all duration-200 ${
            i < visibleCount ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1"
          }`}
        >
          {word}{i < words.length - 1 ? "\u00A0" : ""}
        </span>
      ))}
      {visibleCount >= words.length && <>&rdquo;</>}
    </p>
  )
}

export function TeamRadioCard({ driver }: { driver: DriverId }) {
  const driverNum = driver === "albon" ? 23 : 55
  const driverName = driver === "albon" ? "Albon" : "Sainz"

  const [clips, setClips] = useState<RadioClip[]>([])
  const [laps, setLaps] = useState<LapEntry[]>([])
  const [sessionMap, setSessionMap] = useState<Map<number, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [playingUrl, setPlayingUrl] = useState<string | null>(null)
  const [transcripts, setTranscripts] = useState<Map<string, string>>(new Map())
  const [transcribing, setTranscribing] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const raceSessionKey = Number(getSessionKey()) || 0

  useEffect(() => {
    let stale = false
    setLoading(true)
    setError(null)
    setClips([])
    setLaps([])
    setPlayingUrl(null)

    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }

    const mk = getMeetingKey()
    const sk = getSessionKey()
    const radioUrl = `https://api.openf1.org/v1/team_radio?meeting_key=${mk}&driver_number=${driverNum}`
    const lapsUrl = `https://api.openf1.org/v1/laps?session_key=${sk}&driver_number=${driverNum}`
    const sessionsUrl = `https://api.openf1.org/v1/sessions?meeting_key=${mk}`

    function fetchClips(isInitial: boolean) {
      const simIso = simNow().toISOString()
      const timeFilteredRadioUrl = `${radioUrl}&date%3C=${encodeURIComponent(simIso)}`
      const timeFilteredLapsUrl = `${lapsUrl}&date_start%3C=${encodeURIComponent(simIso)}`
      Promise.all([
        cachedFetch<RadioClip[]>(timeFilteredRadioUrl).catch(() => [] as RadioClip[]),
        cachedFetch<LapEntry[]>(timeFilteredLapsUrl).catch(() => [] as LapEntry[]),
        cachedFetch<SessionInfo[]>(sessionsUrl).catch(() => [] as SessionInfo[]),
      ]).then(([radioData, lapData, sessionsData]) => {
        if (stale) return

        if (Array.isArray(lapData) && lapData.length > 0) {
          setLaps(lapData)
        }

        if (Array.isArray(sessionsData) && sessionsData.length > 0) {
          const map = new Map<number, string>()
          for (const s of sessionsData) {
            map.set(s.session_key, shortSessionLabel(s.session_type ?? "", s.session_name ?? ""))
          }
          setSessionMap(map)
        }

        const sorted = [...radioData].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        if (isInitial) {
          setClips(sorted)
        } else {
          setClips((prev) => {
            const existingUrls = new Set(prev.map((c) => c.recording_url))
            const newClips = sorted.filter((c) => !existingUrls.has(c.recording_url))
            if (newClips.length === 0) return prev
            return [...newClips, ...prev]
          })
        }
        setLoading(false)
      }).catch(() => {
        if (stale) return
        if (isInitial) {
          setError("Failed to load team radio clips.")
          setLoading(false)
        }
      })
    }

    fetchClips(true)
    const timer = setInterval(() => fetchClips(false), 30_000)

    return () => {
      stale = true
      clearInterval(timer)
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
    }
  }, [driver, driverNum])

  const togglePlay = (url: string) => {
    if (playingUrl === url && audioRef.current) {
      audioRef.current.pause()
      setPlayingUrl(null)
      return
    }

    if (audioRef.current) {
      audioRef.current.pause()
    }

    const audio = new Audio(url)
    audioRef.current = audio
    setPlayingUrl(url)

    audio.play().catch(() => {
      setPlayingUrl(null)
    })

    audio.addEventListener("ended", () => {
      setPlayingUrl(null)
    })
    audio.addEventListener("error", () => {
      setPlayingUrl(null)
    })
  }

  const transcribe = async (url: string) => {
    if (transcripts.has(url) || transcribing) return
    setTranscribing(url)
    try {
      const res = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      })
      const data = await res.json()
      if (data.text !== undefined) {
        setTranscripts((prev) => new Map(prev).set(url, data.text))
      } else {
        setTranscripts((prev) => new Map(prev).set(url, `[Error: ${data.error ?? "unknown"}]`))
      }
    } catch {
      setTranscripts((prev) => new Map(prev).set(url, "[Transcription failed]"))
    } finally {
      setTranscribing(null)
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#2563EB]/10 flex items-center justify-center border border-[#2563EB]/20">
            <Radio className="w-5 h-5 text-[#2563EB]" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground text-sm">Team Radio</h3>
            <p className="text-xs text-muted-foreground">#{driverNum} {driverName}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-2.5 py-0.5 rounded-full bg-secondary border border-border">
            <span className="text-xs font-mono text-muted-foreground">{clips.length} clip{clips.length !== 1 ? "s" : ""}</span>
          </span>
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs text-emerald-400 font-mono">LIVE</span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto scrollbar-hide p-4 flex flex-col gap-2" style={{ scrollbarWidth: "none", WebkitOverflowScrolling: "touch" }}>
        {loading && (
          <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Loading radio clips...</span>
          </div>
        )}

        {error && (
          <div className="flex items-center justify-center py-12">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {!loading && !error && clips.length === 0 && (
          <div className="flex items-center justify-center py-12">
            <p className="text-sm text-muted-foreground">No team radio clips available</p>
          </div>
        )}

        {clips.map((clip) => {
          const isPlaying = playingUrl === clip.recording_url
          const isRaceSession = clip.session_key === raceSessionKey
          const lap = isRaceSession ? clipToLap(clip.date, laps) : null
          const sessionLabel = sessionMap.get(clip.session_key)
          const transcript = transcripts.get(clip.recording_url)
          const isTranscribing = transcribing === clip.recording_url
          return (
            <div
              key={clip.recording_url}
              className={`rounded-xl border transition-all ${
                isPlaying
                  ? "bg-[#2563EB]/10 border-[#2563EB]/40"
                  : "bg-secondary/60 border-border hover:border-[#2563EB]/20"
              }`}
            >
              <div className="flex items-center gap-3 px-4 py-3">
                {/* Play/Pause button */}
                <button
                  onClick={() => togglePlay(clip.recording_url)}
                  className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${
                    isPlaying
                      ? "bg-[#2563EB] text-white"
                      : "bg-secondary border border-border text-muted-foreground hover:text-foreground hover:border-[#2563EB]/30"
                  }`}
                  aria-label={isPlaying ? "Pause" : "Play"}
                >
                  {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
                </button>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono text-foreground">{formatTime(clip.date)}</span>
                    {lap != null && (
                      <span className="px-1.5 py-0.5 rounded-md bg-[#2563EB]/10 text-[#2563EB] text-[10px] font-mono border border-[#2563EB]/20">
                        L{lap}
                      </span>
                    )}
                    {sessionLabel && (
                      <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-mono border ${
                        isRaceSession
                          ? "bg-emerald-400/10 text-emerald-400 border-emerald-400/20"
                          : "bg-secondary text-muted-foreground border-border"
                      }`}>
                        {sessionLabel}
                      </span>
                    )}
                  </div>
                </div>

                {/* Transcribe button */}
                {!transcript && (
                  <button
                    onClick={() => transcribe(clip.recording_url)}
                    disabled={!!transcribing}
                    className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-mono transition-colors flex-shrink-0 ${
                      isTranscribing
                        ? "text-[#2563EB]"
                        : transcribing
                          ? "text-muted-foreground/40 cursor-not-allowed"
                          : "text-muted-foreground hover:text-[#2563EB] hover:bg-[#2563EB]/10"
                    }`}
                    aria-label="Transcribe"
                  >
                    {isTranscribing ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <FileText className="w-3 h-3" />
                    )}
                    {isTranscribing ? "Transcribing..." : "Transcribe"}
                  </button>
                )}

                {/* Audio bars animation when playing */}
                {isPlaying && (
                  <div className="flex items-end gap-0.5 h-4 flex-shrink-0">
                    <div className="w-1 bg-[#2563EB] rounded-full animate-[audioBar1_0.8s_ease-in-out_infinite]" />
                    <div className="w-1 bg-[#2563EB] rounded-full animate-[audioBar2_0.6s_ease-in-out_infinite]" />
                    <div className="w-1 bg-[#2563EB] rounded-full animate-[audioBar3_0.7s_ease-in-out_infinite]" />
                    <div className="w-1 bg-[#2563EB] rounded-full animate-[audioBar4_0.9s_ease-in-out_infinite]" />
                  </div>
                )}
              </div>

              {/* Transcript display — rolling text */}
              {transcript && (
                <div className="px-4 pb-3 pt-0">
                  <RollingTranscript text={transcript} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
