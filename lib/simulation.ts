/**
 * Dev Simulation Mode
 *
 * Set these in `.env.local` (requires restart):
 *   NEXT_PUBLIC_SIM_MEETING_KEY  – override meeting_key=latest  (e.g. "1229")
 *   NEXT_PUBLIC_SIM_SESSION_KEY  – override session_key=latest  (e.g. "9158")
 *   NEXT_PUBLIC_SIM_TIME         – ISO timestamp treated as "now" (e.g. "2024-05-19T14:30:00Z")
 *   NEXT_PUBLIC_SIM_START_LAP    – starting lap for dashboards  (e.g. "24")
 */

const BASE = "https://api.openf1.org/v1"

export function getMeetingsUrl(): string {
  const key = process.env.NEXT_PUBLIC_SIM_MEETING_KEY
  return key
    ? `${BASE}/meetings?meeting_key=${key}`
    : `${BASE}/meetings?meeting_key=latest`
}

export function getSessionsUrl(): string {
  const key = process.env.NEXT_PUBLIC_SIM_SESSION_KEY
  return key
    ? `${BASE}/sessions?session_key=${key}`
    : `${BASE}/sessions?session_key=latest`
}

// Rolling sim clock: starts at the env timestamp and advances in real-time
const _simOrigin = process.env.NEXT_PUBLIC_SIM_TIME
  ? new Date(process.env.NEXT_PUBLIC_SIM_TIME).getTime()
  : null
const _realOrigin = Date.now()

export function now(): Date {
  if (_simOrigin == null) return new Date()
  const elapsed = Date.now() - _realOrigin
  return new Date(_simOrigin + elapsed)
}

export function getMeetingKey(): string {
  return process.env.NEXT_PUBLIC_SIM_MEETING_KEY ?? "latest"
}

export function getSessionKey(): string {
  return process.env.NEXT_PUBLIC_SIM_SESSION_KEY ?? "latest"
}

export function getStartLap(fallback: number): number {
  const raw = process.env.NEXT_PUBLIC_SIM_START_LAP
  if (!raw) return fallback
  const parsed = parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

// Derive a short label from the session type (e.g. "Practice", "Race Day")
export function sessionTypeToLabel(sessionType: string): string {
  const t = sessionType.toLowerCase()
  if (t.includes("race") && !t.includes("sprint")) return "Race Day"
  if (t.includes("sprint")) return "Sprint"
  if (t.includes("qualifying")) return "Qualifying"
  if (t.includes("practice")) return "Practice"
  return "Session"
}

// Module-level cache: same OpenF1 URL → reuse the in-flight/resolved promise
// Entries expire after 30s so rolling sim time gets fresh data each poll
const _urlCache = new Map<string, { promise: Promise<any>; ts: number }>()

export function cachedFetch<T = any>(url: string): Promise<T> {
  const entry = _urlCache.get(url)
  if (entry && Date.now() - entry.ts < 30_000) {
    return entry.promise as Promise<T>
  }
  const promise = fetch(url)
    .then((r) => { if (!r.ok) throw new Error(`${r.status}`); return r.json() })
    .catch((err) => { _urlCache.delete(url); throw err })
  _urlCache.set(url, { promise, ts: Date.now() })
  return promise as Promise<T>
}
