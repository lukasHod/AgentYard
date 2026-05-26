import { hashStringToInt } from './hash'
import { SHIP_MODELS } from './shipModels'

export interface ShipParams {
  modelIndex: number  // 0..SHIP_MODELS.length-1
  modelUrl: string
  hueShift: number    // 0..360
}

export function deriveShipParams(featureId: number, featureName: string): ShipParams {
  const seed = hashStringToInt(`${featureId}:${featureName}`)
  const modelIndex = seed % SHIP_MODELS.length
  return {
    modelIndex,
    modelUrl: SHIP_MODELS[modelIndex]!.url,
    hueShift: (seed >>> 8) % 360,
  }
}
