"use client"

import { useState, useEffect, useRef } from "react"
import { MessageCircle, Send, Mic, X } from "lucide-react"
import { getMeetingKey, getSessionKey, getStartLap } from "@/lib/simulation"
import { usePhoneFrame } from "@/lib/phone-frame-context"
import {
  Drawer,
  DrawerTrigger,
  DrawerContent,
  DrawerClose,
  DrawerTitle,
} from "@/components/ui/drawer"

// --- Ask Airia helper ---

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

// --- Chat Panel ---

function AskAiPanel() {
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
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#2563EB]/10 flex items-center justify-center border border-[#2563EB]/20">
            <MessageCircle className="w-5 h-5 text-[#2563EB]" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground text-sm">Ask Airia</h3>
            <p className="text-xs text-muted-foreground">AI Assistant</p>
          </div>
        </div>
        <DrawerClose className="p-2 rounded-lg hover:bg-secondary transition-colors">
          <X className="w-4 h-4 text-muted-foreground" />
        </DrawerClose>
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

// --- Floating Action Button + Drawer ---

export function AskAiFab() {
  const phoneFrame = usePhoneFrame()
  return (
    <Drawer container={phoneFrame}>
      <div className="sticky bottom-0 z-30 pointer-events-none">
        <div className="flex justify-end px-5 pb-6 pt-2">
          <DrawerTrigger asChild>
            <button
              className="pointer-events-auto w-14 h-14 rounded-full bg-[#2563EB] text-white shadow-lg shadow-[#2563EB]/30 flex items-center justify-center hover:bg-[#2563EB]/90 transition-colors active:scale-95"
              aria-label="Ask AI"
            >
              <MessageCircle className="w-6 h-6" />
            </button>
          </DrawerTrigger>
        </div>
      </div>
      <DrawerContent className="max-h-[85vh]">
        <DrawerTitle className="sr-only">Ask Airia</DrawerTitle>
        <AskAiPanel />
      </DrawerContent>
    </Drawer>
  )
}
