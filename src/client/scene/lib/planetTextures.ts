import type { PlanetTextureName } from '../../../core/planetTextures'

export function getPlanetTexturePath(texture: PlanetTextureName): string {
  return `/textures/planets/${texture}.png`
}
