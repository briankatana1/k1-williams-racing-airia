import { NextResponse } from "next/server"

let cached: any = null

export async function GET() {
  if (cached) return NextResponse.json(cached)

  try {
    const res = await fetch("https://api.multiviewer.app/api/v1/circuits/70/2025")
    if (!res.ok) {
      return NextResponse.json({ error: `Upstream ${res.status}` }, { status: res.statusText ? res.status : 502 })
    }
    cached = await res.json()
    return NextResponse.json(cached)
  } catch {
    return NextResponse.json({ error: "Failed to fetch circuit data" }, { status: 502 })
  }
}
