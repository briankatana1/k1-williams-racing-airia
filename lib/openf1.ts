import { getSessionKey, getStartLap, now, cachedFetch } from "./simulation"

const BASE = "https://api.openf1.org/v1"

export interface PitData {
  lastPitLap: number | null
  pitDuration: number | null
  compound: string
  tyreAge: number
  position: number | null
  gapToLeader: string
  weather: string
}

async function f1(path: string): Promise<any[]> {
  try {
    const data = await cachedFetch<any>(`${BASE}${path}`)
    return Array.isArray(data) ? data : []
  } catch (err) {
    console.warn(`[openf1] ${path} failed:`, err)
    return []
  }
}

export async function fetchPitData(driverNumber: number): Promise<PitData> {
  const sk = getSessionKey()
  const simTime = now().toISOString()

  const simEncoded = encodeURIComponent(simTime)

  // 1) Fetch laps first to derive dynamic currentLap
  const laps = await f1(`/laps?driver_number=${driverNumber}&session_key=${sk}&date_start%3C=${simEncoded}`)
  let currentLap = getStartLap(1)
  const simMs = new Date(simTime).getTime()
  for (const l of laps) {
    if (new Date(l.date_start).getTime() <= simMs) currentLap = l.lap_number
    else break
  }

  // 2) Fetch remaining data sequentially (OpenF1 rate-limits concurrent requests)
  const stints = await f1(`/stints?driver_number=${driverNumber}&session_key=${sk}&lap_start%3C=${currentLap}`)
  const pits = await f1(`/pit?driver_number=${driverNumber}&session_key=${sk}&lap_number%3C=${currentLap}`)
  const positions = await f1(`/position?driver_number=${driverNumber}&session_key=${sk}&date%3C=${simEncoded}`)
  const intervals = await f1(`/intervals?driver_number=${driverNumber}&session_key=${sk}&date%3C=${simEncoded}`)
  const weather = await f1(`/weather?session_key=${sk}&date%3C=${simEncoded}`)

  // Latest stint at or before current lap
  const latestStint = stints.length > 0 ? stints[stints.length - 1] : null
  const compound: string = latestStint?.compound ?? "UNKNOWN"
  const stintStartLap: number = latestStint?.lap_start ?? 0

  // Last pit stop at or before current lap
  const lastPit = pits.length > 0 ? pits[pits.length - 1] : null
  const lastPitLap: number | null = lastPit?.lap_number ?? null
  const pitDuration: number | null = lastPit?.pit_duration ?? null

  // Tyre age
  const tyreAge = stintStartLap > 0 ? Math.max(0, currentLap - stintStartLap) : 0

  // Latest position at or before sim time
  const latestPosition = positions.length > 0 ? positions[positions.length - 1] : null
  const position: number | null = latestPosition?.position ?? null

  // Gap to leader from intervals API
  const latestInterval = intervals.length > 0 ? intervals[intervals.length - 1] : null
  const gapToLeader = latestInterval?.gap_to_leader != null
    ? `+${Number(latestInterval.gap_to_leader).toFixed(3)}s`
    : "N/A"

  // Weather at or before sim time
  const latestWeather = weather.length > 0 ? weather[weather.length - 1] : null
  const airTemp = latestWeather?.air_temperature ?? "?"
  const rainfall = latestWeather?.rainfall != null && latestWeather.rainfall > 0 ? "Rain" : "Dry"
  const weatherStr = `${airTemp}C / ${rainfall}`

  return { lastPitLap, pitDuration, compound, tyreAge, position, gapToLeader, weather: weatherStr }
}
