export const PLANET_TEXTURE_NAMES = [
  'Alpine',
  'Gaseous1',
  'Gaseous2',
  'Gaseous3',
  'Gaseous4',
  'Icy',
  'Martian',
  'Savannah',
  'Swamp',
  'Terrestrial1',
  'Terrestrial2',
  'Terrestrial3',
  'Terrestrial4',
  'Tropical',
  'Venusian',
  'Volcanic',
] as const

export type PlanetTextureName = typeof PLANET_TEXTURE_NAMES[number]
