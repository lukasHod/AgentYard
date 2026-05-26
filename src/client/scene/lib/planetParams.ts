import { hashStringToInt, hashByte, deriveHash } from './hash'

export type SurfaceType = 'rocky' | 'gas' | 'lava' | 'ice' | 'ocean' | 'crystal' | 'ringed'

export interface PlanetParams {
  radius: number          // 0.8..1.2
  surfaceType: SurfaceType
  paletteHue: number      // 0..360
  atmosphereHue: number   // 0..360
  rotationSpeed: number   // rev/min (0.3..1.0)
  hasRing: boolean
}

const SURFACES: SurfaceType[] = ['rocky', 'gas', 'lava', 'ice', 'ocean', 'crystal', 'ringed']

export function derivePlanetParams(name: string): PlanetParams {
  const h1 = hashStringToInt(name)
  const h2 = deriveHash(h1, 'planet')

  const radius = 0.8 + (hashByte(h1, 0) / 255) * 0.4
  const surfaceType = SURFACES[hashByte(h1, 1) % SURFACES.length]!
  const paletteHue = (hashByte(h1, 2) / 255) * 360
  const atmosphereHue = (paletteHue + 30) % 360
  const rotationSpeed = 0.3 + (hashByte(h1, 3) / 255) * 0.7
  // Independent 10% chance of a ring, OR forced by surfaceType === 'ringed'.
  const hasRing = surfaceType === 'ringed' || hashByte(h2, 0) < 26

  return { radius, surfaceType, paletteHue, atmosphereHue, rotationSpeed, hasRing }
}
