export interface OrbitConfig {
  firstRing: number
  ringGap: number
}

export interface OrbitPos {
  radius: number
  angle: number
}

/**
 * Index-N planet sits on ring N. (One planet per ring keeps the scene readable
 * for the typical handful of projects.)
 */
export function planetOrbitPositions(
  count: number,
  baseAngle = 0,
  cfg: OrbitConfig = { firstRing: 6, ringGap: 3 },
): OrbitPos[] {
  const out: OrbitPos[] = []
  for (let i = 0; i < count; i++) {
    out.push({ radius: cfg.firstRing + i * cfg.ringGap, angle: baseAngle })
  }
  return out
}

/** N evenly spaced angles in [0, 2π). */
export function ringAngles(n: number): number[] {
  if (n <= 0) return []
  const step = (2 * Math.PI) / n
  return Array.from({ length: n }, (_, i) => i * step)
}
