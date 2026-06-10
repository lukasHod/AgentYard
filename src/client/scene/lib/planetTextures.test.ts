import { describe, expect, it } from 'vitest'
import { getPlanetTexturePath } from './planetTextures'

describe('getPlanetTexturePath', () => {
  it('maps stored DB texture names to planet texture assets', () => {
    expect(getPlanetTexturePath('Gaseous2')).toBe('/textures/planets/Gaseous2.png')
    expect(getPlanetTexturePath('Terrestrial4')).toBe('/textures/planets/Terrestrial4.png')
  })
})
