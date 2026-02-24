import { getSessionKey, getStartLap, now, cachedFetch } from "./simulation"

const BASE = "https://api.openf1.org/v1"

export interface PitData {
  lastPitLap: number | null
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
  } catch {
    return []
  }
}

export async function fetchPitData(driverNumber: number): Promise<PitData> {
  const sk = getSessionKey()
  const currentLap = getStartLap(1)
  const simTime = now().toISOString()

  // 4 sequential calls — use API-level filtering to keep responses small
  const stints = await f1(`/stints?driver_number=${driverNumber}&session_key=${sk}&lap_start<=${currentLap}`)
  const pits = await f1(`/pit?driver_number=${driverNumber}&session_key=${sk}&lap_number<=${currentLap}`)
  const positions = await f1(`/position?driver_number=${driverNumber}&session_key=${sk}&date<=${simTime}`)
  const weather = await f1(`/weather?session_key=${sk}&date<=${simTime}`)

  // Latest stint at or before current lap
  const latestStint = stints.length > 0 ? stints[stints.length - 1] : null
  const compound: string = latestStint?.compound ?? "UNKNOWN"
  const stintStartLap: number = latestStint?.lap_start ?? 0

  // Last pit stop at or before current lap
  const lastPitLap: number | null = pits.length > 0 ? pits[pits.length - 1].lap_number : null

  // Tyre age
  const tyreAge = stintStartLap > 0 ? Math.max(0, currentLap - stintStartLap) : 0

  // Latest position at or before sim time
  const latestPosition = positions.length > 0 ? positions[positions.length - 1] : null
  const position: number | null = latestPosition?.position ?? null
  const gapToLeader = "N/A"

  // Weather at or before sim time
  const latestWeather = weather.length > 0 ? weather[weather.length - 1] : null
  const airTemp = latestWeather?.air_temperature ?? "?"
  const rainfall = latestWeather?.rainfall != null && latestWeather.rainfall > 0 ? "Rain" : "Dry"
  const weatherStr = `${airTemp}C / ${rainfall}`

  return { lastPitLap, compound, tyreAge, position, gapToLeader, weather: weatherStr }
}
