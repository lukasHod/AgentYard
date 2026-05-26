import { Color } from 'three'
import { useMemo } from 'react'
import type { PlanetParams } from './lib/planetParams'

/**
 * Phase-1 material: hue-tinted MeshStandardMaterial. Surface-type shader
 * variants land in Phase 14 polish; for now every planet renders with the
 * same procedural look but tinted distinctively per project.
 */
export function PlanetMaterial({ params }: { params: PlanetParams }) {
  const color = useMemo(() => {
    const c = new Color()
    c.setHSL(params.paletteHue / 360, 0.55, 0.45)
    return c
  }, [params.paletteHue])
  return <meshStandardMaterial color={color} roughness={0.6} metalness={0.05} />
}
