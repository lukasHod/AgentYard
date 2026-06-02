// Add a new ship model:
//   1. Drop the .glb file into public/models/ships/
//   2. Add a new entry to SHIP_MODELS below
// deriveShipParams() picks an index modulo SHIP_MODELS.length, so the next
// entry automatically participates in feature → ship assignment.

export interface ShipModel {
  url: string
  /** Optional display name for debugging; not used in rendering. */
  name?: string
}

export const SHIP_MODELS: ReadonlyArray<ShipModel> = [
  { url: '/models/ships/ships.glb', name: 'intergalactic-spaceships' },
]
