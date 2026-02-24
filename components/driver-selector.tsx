"use client"

import { cn } from "@/lib/utils"

export type DriverId = "albon" | "sainz"

interface DriverSelectorProps {
  selected: DriverId
  onChange: (driver: DriverId) => void
}

const drivers = [
  { id: "albon" as const, name: "Albon", firstName: "Alex", number: 23, country: "TH" },
  { id: "sainz" as const, name: "Sainz", firstName: "Carlos", number: 55, country: "ES" },
]

export function DriverSelector({ selected, onChange }: DriverSelectorProps) {
  return (
    <div className="flex items-center gap-2 p-1 rounded-xl bg-secondary/60 border border-border">
      {drivers.map((driver) => (
        <button
          key={driver.id}
          onClick={() => onChange(driver.id)}
          className={cn(
            "flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all",
            selected === driver.id
              ? "bg-[#2563EB] text-[#FFFFFF] shadow-lg shadow-[#2563EB]/20"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <span className="font-mono font-bold text-base">{driver.number}</span>
          <span className="uppercase tracking-wider text-xs">{driver.name}</span>
        </button>
      ))}
    </div>
  )
}
