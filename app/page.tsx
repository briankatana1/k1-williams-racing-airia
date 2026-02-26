"use client"

import { useState, useCallback } from "react"
import { WelcomeScreen } from "@/components/welcome-screen"
import { LocationSelect } from "@/components/location-select"
import { WatchingSelect, type LocationType } from "@/components/watching-select"
import { VenueDashboard } from "@/components/venue-dashboard"
import { HomeDashboard } from "@/components/home-dashboard"
import { PhoneFrameContext } from "@/lib/phone-frame-context"

type AppScreen = "welcome" | "location" | "watching" | "venue" | "home"

export default function Page() {
  const [screen, setScreen] = useState<AppScreen>("welcome")
  const [phoneFrameEl, setPhoneFrameEl] = useState<HTMLElement | null>(null)
  const phoneFrameRef = useCallback((node: HTMLDivElement | null) => {
    setPhoneFrameEl(node)
  }, [])

  const handleLocationSelect = (location: LocationType) => {
    setScreen(location === "venue" ? "venue" : "home")
  }

  return (
    <>
      {/* Mobile: full screen */}
      <div className="md:hidden min-h-dvh">
        {screen === "welcome" && (
          <WelcomeScreen onReady={() => setScreen("location")} />
        )}
        {screen === "location" && (
          <LocationSelect
            onContinue={() => setScreen("watching")}
            onBack={() => setScreen("welcome")}
          />
        )}
        {screen === "watching" && (
          <WatchingSelect
            onSelect={handleLocationSelect}
            onBack={() => setScreen("location")}
          />
        )}
        {screen === "venue" && (
          <VenueDashboard onBack={() => setScreen("watching")} />
        )}
        {screen === "home" && (
          <HomeDashboard onBack={() => setScreen("watching")} />
        )}
      </div>

      {/* Desktop: phone frame — scales to fit viewport */}
      <div className="hidden md:flex items-center justify-center h-dvh bg-neutral-950 p-2 overflow-hidden">
        <div
          className="relative"
          style={{ width: 393, height: 852, maxHeight: "100%" }}
        >
          {/* Phone bezel */}
          <div
            ref={phoneFrameRef}
            className="relative h-full w-full rounded-[3rem] border-[6px] border-neutral-700 shadow-[0_0_80px_rgba(37,99,235,0.08),0_0_0_1px_rgba(255,255,255,0.06)] bg-background overflow-hidden"
            style={{ contain: "layout" }}
          >
            {/* Notch / Dynamic Island */}
            <div className="absolute top-2.5 left-1/2 -translate-x-1/2 z-50 w-[120px] h-[32px] bg-black rounded-full" />

            {/* Screen content — hidden scrollbar, override min-h-dvh to frame height */}
            <PhoneFrameContext.Provider value={phoneFrameEl}>
              <div className="h-full overflow-y-auto overflow-x-hidden [scrollbar-width:none] [-webkit-overflow-scrolling:touch] [&::-webkit-scrollbar]:hidden [&>*]:!min-h-full [&>*]:!h-full">
                {screen === "welcome" && (
                  <WelcomeScreen onReady={() => setScreen("location")} />
                )}
                {screen === "location" && (
                  <LocationSelect
                    onContinue={() => setScreen("watching")}
                    onBack={() => setScreen("welcome")}
                  />
                )}
                {screen === "watching" && (
                  <WatchingSelect
                    onSelect={handleLocationSelect}
                    onBack={() => setScreen("location")}
                  />
                )}
                {screen === "venue" && (
                  <VenueDashboard onBack={() => setScreen("watching")} />
                )}
                {screen === "home" && (
                  <HomeDashboard onBack={() => setScreen("watching")} />
                )}
              </div>
            </PhoneFrameContext.Provider>

            {/* Home indicator */}
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-50 w-[134px] h-[5px] bg-white/20 rounded-full" />
          </div>
        </div>
      </div>
    </>
  )
}
