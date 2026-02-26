"use client"

export interface CircuitCorner {
  number: number
  trackPosition: { x: number; y: number }
  angle: number
  length: number
}

export interface CircuitLayout {
  x: number[]
  y: number[]
  corners: CircuitCorner[]
  rotation: number
}

export interface DriverPosition {
  x: number
  y: number
}

let _circuitLayoutCache: Promise<CircuitLayout | null> | null = null

export function fetchCircuitLayout(): Promise<CircuitLayout | null> {
  if (!_circuitLayoutCache) {
    _circuitLayoutCache = fetch("/api/circuit")
      .then((r) => {
        if (!r.ok) throw new Error(`Circuit API ${r.status}`)
        return r.json()
      })
      .catch((err) => {
        _circuitLayoutCache = null
        console.warn("Failed to load circuit layout:", err)
        return null
      })
  }
  return _circuitLayoutCache
}

export function findNearestCorner(pos: DriverPosition, corners: CircuitCorner[]): number | null {
  if (!corners.length) return null
  let best = corners[0]
  let bestDist = Infinity
  for (const c of corners) {
    const dx = pos.x - c.trackPosition.x
    const dy = pos.y - c.trackPosition.y
    const d = dx * dx + dy * dy
    if (d < bestDist) { bestDist = d; best = c }
  }
  // Only highlight if driver is within ~200m of the corner (squared distance threshold)
  if (bestDist > 200 * 200) return null
  return best.number
}

export function MiniTrackMap({ layout, activeCorner, driverPos }: { layout: CircuitLayout | null; activeCorner: number | null; driverPos: DriverPosition | null }) {
  if (!layout || !layout.x || layout.x.length === 0) return null

  // Downsample to ~200 points for performance
  const step = Math.max(1, Math.floor(layout.x.length / 200))
  const points: { x: number; y: number }[] = []
  for (let i = 0; i < layout.x.length; i += step) {
    points.push({ x: layout.x[i], y: layout.y[i] })
  }

  // Use full (non-downsampled) bounds so corners align
  const minX = Math.min(...layout.x)
  const maxX = Math.max(...layout.x)
  const minY = Math.min(...layout.y)
  const maxY = Math.max(...layout.y)
  const padding = 200
  const rawW = maxX - minX + padding * 2
  const rawH = maxY - minY + padding * 2

  const pathD = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x - minX + padding},${p.y - minY + padding}`)
    .join(" ") + " Z"

  // Apply rotation inside SVG and compute tight bounding box of rotated content
  const rotation = layout.rotation ?? 280
  const rad = (rotation * Math.PI) / 180
  const cosR = Math.cos(rad)
  const sinR = Math.sin(rad)
  const centerX = rawW / 2
  const centerY = rawH / 2

  // Rotate all outline points + corner positions to find the tight rotated bounding box
  const allPts: { x: number; y: number }[] = [
    ...points.map((p) => ({ x: p.x - minX + padding, y: p.y - minY + padding })),
    ...(layout.corners ?? []).map((c) => ({ x: c.trackPosition.x - minX + padding, y: c.trackPosition.y - minY + padding })),
  ]
  let rMinX = Infinity, rMaxX = -Infinity, rMinY = Infinity, rMaxY = -Infinity
  for (const p of allPts) {
    const dx = p.x - centerX, dy = p.y - centerY
    const rx = dx * cosR - dy * sinR + centerX
    const ry = dx * sinR + dy * cosR + centerY
    if (rx < rMinX) rMinX = rx
    if (rx > rMaxX) rMaxX = rx
    if (ry < rMinY) rMinY = ry
    if (ry > rMaxY) rMaxY = ry
  }
  const rotPad = 150
  const vbX = rMinX - rotPad
  const vbY = rMinY - rotPad
  const vbW = rMaxX - rMinX + rotPad * 2
  const vbH = rMaxY - rMinY + rotPad * 2

  // Scale factors for corner dots / text relative to viewbox size
  const refSize = Math.max(vbW, vbH)
  const dotR = refSize / 80
  const fontSize = refSize / 60

  return (
    <div className="rounded-xl bg-secondary/40 border border-border p-3 mb-4">
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2 block">Track Map</span>
      <svg
        viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
        className="w-full"
        style={{ maxHeight: "22rem" }}
        preserveAspectRatio="xMidYMid meet"
      >
        <g transform={`rotate(${rotation},${centerX},${centerY})`}>
          {/* Track outline */}
          <path d={pathD} fill="none" stroke="currentColor" strokeWidth={Math.max(8, refSize / 200)} className="text-border" strokeLinecap="round" strokeLinejoin="round" />
          <path d={pathD} fill="none" stroke="currentColor" strokeWidth={Math.max(3, refSize / 500)} className="text-muted-foreground/40" strokeLinecap="round" strokeLinejoin="round" />

          {/* Corner markers */}
          {(layout.corners ?? []).map((c) => {
            const cx = c.trackPosition.x - minX + padding
            const cy = c.trackPosition.y - minY + padding
            const isActive = activeCorner === c.number
            return (
              <g key={c.number}>
                {isActive && (
                  <>
                    <circle cx={cx} cy={cy} r={dotR * 3} fill="#EF4444" opacity={0.3} className="animate-ping" />
                    <circle cx={cx} cy={cy} r={dotR * 1.6} fill="#EF4444" className="animate-pulse" />
                  </>
                )}
                <circle cx={cx} cy={cy} r={isActive ? dotR * 1.4 : dotR} fill={isActive ? "#EF4444" : "#2563EB"} opacity={isActive ? 1 : 0.6} />
                <text
                  x={cx}
                  y={cy}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="white"
                  fontSize={isActive ? fontSize * 1.1 : fontSize}
                  fontWeight="bold"
                  fontFamily="monospace"
                  transform={`rotate(${-rotation},${cx},${cy})`}
                >
                  {c.number}
                </text>
              </g>
            )
          })}

          {/* Driver position */}
          {driverPos && (() => {
            const dx = driverPos.x - minX + padding
            const dy = driverPos.y - minY + padding
            return (
              <g>
                <circle cx={dx} cy={dy} r={dotR * 4} fill="#EF4444" opacity={0.2} className="animate-ping" />
                <circle cx={dx} cy={dy} r={dotR * 2} fill="#EF4444" className="animate-pulse" />
                <circle cx={dx} cy={dy} r={dotR * 1.5} fill="#EF4444" stroke="white" strokeWidth={dotR * 0.4} />
              </g>
            )
          })()}
        </g>
      </svg>
    </div>
  )
}
