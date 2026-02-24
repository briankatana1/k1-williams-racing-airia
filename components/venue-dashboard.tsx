"use client"

import { useState, useEffect, useRef } from "react"
import { ArrowLeft, Zap, MessageCircle, Send, Mic, CloudRain } from "lucide-react"
import Image from "next/image"
import { DriverSelector, type DriverId } from "./driver-selector"
import { fetchPitData, type PitData } from "@/lib/openf1"
import { getMeetingKey, getSessionKey, getStartLap, getSessionsUrl, cachedFetch, sessionTypeToLabel } from "@/lib/simulation"

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

// Cache the in-flight promise so strict-mode remount reuses it (1 call, not 2)
const _fetchCache = new Map<string, Promise<[PromiseSettledResult<PitData>, PromiseSettledResult<any>]>>()

function doFetch(driver: DriverId) {
  const name = driver === "albon" ? "Albon" : "Sainz"
  const num = driver === "albon" ? 23 : 55
  const meetingKey = getMeetingKey()
  const sessionKey = getSessionKey()
  const currentLap = getStartLap(30)
  const simTime = process.env.NEXT_PUBLIC_SIM_TIME ?? new Date().toISOString()

  return Promise.allSettled([
    fetchPitData(num),
    fetch("/api/airia", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userInput: `Analyze pit strategy for driver ${name} #${num}. Meeting key: ${meetingKey}, Session key: ${sessionKey}, current lap: ${currentLap}, current time: ${simTime}.`,
        pipeline: "pit",
      }),
    }).then(r => r.json()),
  ]) as Promise<[PromiseSettledResult<PitData>, PromiseSettledResult<any>]>
}

function PitStrategyCard({ driver }: { driver: DriverId }) {
  const [pitData, setPitData] = useState<PitData | null>(null)
  const [strategy, setStrategy] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const driverName = driver === "albon" ? "Albon" : "Sainz"
  const driverNum = driver === "albon" ? 23 : 55

  useEffect(() => {
    let stale = false

    setLoading(true)
    setPitData(null)
    setStrategy(null)

    // Reuse in-flight promise if one already exists for this driver
    if (!_fetchCache.has(driver)) {
      _fetchCache.set(driver, doFetch(driver))
    }

    _fetchCache.get(driver)!.then(([pitResult, airiaResult]) => {
      if (stale) return

      if (pitResult.status === "fulfilled") {
        setPitData(pitResult.value)
      }

      if (airiaResult.status === "fulfilled" && !airiaResult.value.error) {
        const data = airiaResult.value
        const text = data.result ?? data.output ?? data.response ?? (typeof data === "string" ? data : null)
        setStrategy(text ?? "Strategy analysis unavailable.")
      } else {
        setStrategy("AI analysis is temporarily unavailable.")
      }

      setLoading(false)
    })

    return () => { stale = true }
  }, [driver])

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
        {loading ? (
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <div className="w-8 h-8 border-2 border-[#2563EB]/30 border-t-[#2563EB] rounded-full animate-spin" />
            <span className="text-sm text-muted-foreground font-mono">Analyzing #{driverNum} {driverName} strategy...</span>
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
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-mono text-[#2563EB] uppercase tracking-wider">AI Analysis</span>
              </div>
              <p className="text-sm text-foreground/90 leading-relaxed">{strategy}</p>
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


// --- Voice Assistant ---

interface Message {
  id: number
  role: "user" | "assistant"
  content: string
}

async function askAiria(userInput: string): Promise<string> {
  const meetingKey = getMeetingKey()
  const sessionKey = getSessionKey()
  const currentLap = getStartLap(30)
  const simTime = process.env.NEXT_PUBLIC_SIM_TIME ?? new Date().toISOString()

  const context = `[Context: Meeting key: ${meetingKey}, Session key: ${sessionKey}, current lap: ${currentLap}, current time: ${simTime}]\n\n${userInput}`

  try {
    const res = await fetch("/api/airia", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userInput: context, pipeline: "chat" }),
    })
    const data = await res.json()
    if (data.error) return "Sorry, I could not get a response right now."
    return data.result ?? data.output ?? data.response ?? "No response received."
  } catch {
    return "Sorry, something went wrong. Please try again."
  }
}

function VoiceAssistant() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 0,
      role: "assistant",
      content: "Hey! I am your Williams AI companion. Ask me anything about what is happening in the race — safety cars, penalties, strategy calls, or anything you are curious about.",
    },
  ])
  const [input, setInput] = useState("")
  const [isTyping, setIsTyping] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, isTyping])

  const sendMessage = async (text: string) => {
    if (!text.trim() || isTyping) return

    const userMsg: Message = { id: Date.now(), role: "user", content: text.trim() }
    setMessages((prev) => [...prev, userMsg])
    setInput("")
    setIsTyping(true)

    const response = await askAiria(text.trim())

    setMessages((prev) => [
      ...prev,
      { id: Date.now() + 1, role: "assistant", content: response },
    ])
    setIsTyping(false)
  }

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#2563EB]/10 flex items-center justify-center border border-[#2563EB]/20">
            <MessageCircle className="w-5 h-5 text-[#2563EB]" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground text-sm">{"What Just Happened?"}</h3>
            <p className="text-xs text-muted-foreground">AI Assistant</p>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-hide px-4 py-4 flex flex-col gap-3" style={{ scrollbarWidth: "none", WebkitOverflowScrolling: "touch" }}>
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`max-w-[85%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${
              msg.role === "user"
                ? "ml-auto bg-[#2563EB] text-[#FFFFFF] rounded-br-md"
                : "mr-auto bg-secondary text-foreground rounded-bl-md"
            }`}
          >
            {msg.content}
          </div>
        ))}
        {isTyping && (
          <div className="mr-auto bg-secondary text-foreground rounded-2xl rounded-bl-md px-4 py-3">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#2563EB] animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="w-2 h-2 rounded-full bg-[#2563EB] animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="w-2 h-2 rounded-full bg-[#2563EB] animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
          </div>
        )}
      </div>

      {/* Quick questions */}
      <div className="px-4 pb-2 flex gap-2 flex-wrap flex-shrink-0">
        {["Safety car?", "Tyre update?", "Weather?"].map((q) => (
          <button
            key={q}
            onClick={() => sendMessage(q)}
            disabled={isTyping}
            className="px-3 py-1.5 rounded-full bg-secondary/80 border border-border text-xs text-muted-foreground hover:text-foreground hover:border-[#2563EB]/30 transition-colors disabled:opacity-40"
          >
            {q}
          </button>
        ))}
      </div>

      {/* Input */}
      <div className="px-4 pb-4 pt-2 border-t border-border flex-shrink-0">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            sendMessage(input)
          }}
          className="flex items-center gap-2"
        >
          <button
            type="button"
            className="p-2.5 rounded-xl bg-secondary border border-border hover:border-[#2563EB]/30 transition-colors"
            aria-label="Voice input"
          >
            <Mic className="w-4 h-4 text-muted-foreground" />
          </button>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about the race..."
            className="flex-1 bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-[#2563EB]/50 transition-colors"
          />
          <button
            type="submit"
            disabled={!input.trim() || isTyping}
            className="p-2.5 rounded-xl bg-[#2563EB] text-[#FFFFFF] disabled:opacity-40 hover:bg-[#2563EB]/90 transition-colors"
            aria-label="Send message"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
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

export function VenueDashboard({ onBack }: VenueDashboardProps) {
  const [driver, setDriver] = useState<DriverId>("albon")
  const [activeTab, setActiveTab] = useState<"pit" | "voice">("pit")
  const sessionLabel = useSessionLabel()

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
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[11px] text-emerald-400 font-mono uppercase">At Circuit</span>
            </span>
          </div>
        </div>
        <div className="px-5 pb-3">
          <DriverSelector selected={driver} onChange={setDriver} />
        </div>
      </header>

      {/* Tab switcher */}
      <div className="px-5 pt-4">
        <div className="flex gap-2 p-1 rounded-xl bg-secondary/60 border border-border">
          <button
            onClick={() => setActiveTab("pit")}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === "pit"
                ? "bg-card text-foreground border border-border shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Zap className="w-4 h-4" />
            <span>Pit Strategy</span>
          </button>
          <button
            onClick={() => setActiveTab("voice")}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === "voice"
                ? "bg-card text-foreground border border-border shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <MessageCircle className="w-4 h-4" />
            <span>Ask AI</span>
          </button>
        </div>
      </div>

      {/* Content */}
      <main className="flex-1 min-h-0 px-5 py-4 flex flex-col">
        {activeTab === "pit" ? (
          <PitStrategyCard driver={driver} />
        ) : (
          <VoiceAssistant />
        )}
      </main>
    </div>
  )
}
