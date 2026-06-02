import type { SurfaceType } from './planetParams'
import { hashByte, deriveHash, hashStringToInt } from './hash'

const TEXTURE_SETS: Record<SurfaceType, string[]> = {
  rocky:   ['/textures/planets/Alpine.png', '/textures/planets/Martian.png', '/textures/planets/Savannah.png'],
  gas:     ['/textures/planets/Gaseous1.png', '/textures/planets/Gaseous2.png', '/textures/planets/Gaseous3.png', '/textures/planets/Gaseous4.png'],
  lava:    ['/textures/planets/Volcanic.png'],
  ice:     ['/textures/planets/Icy.png'],
  ocean:   ['/textures/planets/Terrestrial1.png', '/textures/planets/Terrestrial2.png', '/textures/planets/Terrestrial3.png', '/textures/planets/Terrestrial4.png', '/textures/planets/Tropical.png', '/textures/planets/Swamp.png'],
  crystal: ['/textures/planets/Venusian.png', '/textures/planets/Alpine.png'],
  ringed:  ['/textures/planets/Gaseous1.png', '/textures/planets/Gaseous2.png', '/textures/planets/Gaseous3.png', '/textures/planets/Gaseous4.png', '/textures/planets/Terrestrial1.png'],
}

/** Returns a deterministic texture path for a planet name + surface type. */
export function getPlanetTexturePath(name: string, surfaceType: SurfaceType): string {
  const h = deriveHash(hashStringToInt(name), 'texture')
  const set = TEXTURE_SETS[surfaceType]
  return set[hashByte(h, 0) % set.length]!
}
