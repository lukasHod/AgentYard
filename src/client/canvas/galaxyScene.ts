import { Application, BlurFilter, Container, FederatedPointerEvent, Graphics, Ticker } from 'pixi.js'
import type { ShipSummary } from '../../core/types'
import { drawShipSprite, drawStarfield, shipPositionFor } from './sprites'

export type ShipMood = 'idle' | 'active' | 'attention'

export interface GalaxyEvents {
  onShipClick?: (shipId: number) => void
  onShipHover?: (shipId: number, screenX: number, screenY: number) => void
  onShipHoverEnd?: () => void
  onBackgroundClick?: () => void
}

interface ShipEntry {
  container: Container
  halo: Graphics
  ship: ShipSummary
  mood: ShipMood
}

const MIN_ZOOM = 0.4
const MAX_ZOOM = 2.5
const ZOOM_SPEED = 0.0015

/** Galaxy scene — the top-level map of all ships. */
export class GalaxyScene {
  readonly root: Container
  private world: Container
  private ships = new Map<number, ShipEntry>()
  private dragging = false
  private dragStart = { x: 0, y: 0 }
  private worldStart = { x: 0, y: 0 }
  private events: GalaxyEvents = {}
  private app: Application
  private starfield: Container
  private bobTime = 0
  private tickerFn: (t: Ticker) => void
  private hasInitialFit = false

  constructor(app: Application, events: GalaxyEvents = {}) {
    this.app = app
    this.events = events
    this.root = new Container()
    this.world = new Container()
    this.root.addChild(this.world)

    // Center the world (camera at 0,0)
    this.recenter()

    // Starfield in the world coordinate space.
    this.starfield = drawStarfield(3000, 2000)
    this.world.addChildAt(this.starfield, 0)

    this.attachBackgroundInteractions()

    this.tickerFn = (t: Ticker) => this.tick(t)
    this.app.ticker.add(this.tickerFn)
  }

  recenter() {
    this.world.position.set(this.app.screen.width / 2, this.app.screen.height / 2)
  }

  /**
   * Pan + zoom so every ship is comfortably visible.
   * - One ship → centered, scale ~1.2
   * - Many ships → bounding box centered, scale chosen so all fit with padding
   */
  fitToShips(): void {
    if (this.ships.size === 0) return
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const [, entry] of this.ships) {
      // Use the deterministic seeded position (entry.container may be in
      // mid-bob so we read the source-of-truth position instead).
      const pos = entry.container.position
      minX = Math.min(minX, pos.x)
      maxX = Math.max(maxX, pos.x)
      minY = Math.min(minY, pos.y)
      maxY = Math.max(maxY, pos.y)
    }
    const padding = 220
    const width = maxX - minX + 2 * padding
    const height = maxY - minY + 2 * padding
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    const screenW = this.app.screen.width
    const screenH = this.app.screen.height
    const scaleX = screenW / Math.max(width, 1)
    const scaleY = screenH / Math.max(height, 1)
    let scale = Math.min(scaleX, scaleY, 1.5)
    scale = Math.max(scale, MIN_ZOOM)
    this.world.scale.set(scale)
    this.world.position.set(screenW / 2 - cx * scale, screenH / 2 - cy * scale)
  }

  destroy() {
    this.app.ticker.remove(this.tickerFn)
    this.root.destroy({ children: true })
  }

  setShips(list: ShipSummary[], moods?: Map<number, ShipMood>) {
    const incoming = new Map(list.map((s) => [s.id, s]))
    // Remove gone ships.
    for (const [id, entry] of this.ships) {
      if (!incoming.has(id)) {
        this.world.removeChild(entry.container)
        this.world.removeChild(entry.halo)
        entry.container.destroy({ children: true })
        entry.halo.destroy()
        this.ships.delete(id)
      }
    }
    // Add or update.
    for (const ship of list) {
      const existing = this.ships.get(ship.id)
      const mood = moods?.get(ship.id) ?? 'idle'
      if (existing) {
        // Rebuild only if the name changed (visible label).
        if (existing.ship.name !== ship.name) {
          this.world.removeChild(existing.container)
          this.world.removeChild(existing.halo)
          existing.container.destroy({ children: true })
          existing.halo.destroy()
          this.spawnShip(ship, mood)
        } else {
          this.updateMood(existing, mood)
          existing.ship = ship
        }
      } else {
        this.spawnShip(ship, mood)
      }
    }

    // First time we see any ship, frame them all on screen.
    if (!this.hasInitialFit && this.ships.size > 0) {
      this.fitToShips()
      this.hasInitialFit = true
    }
  }

  private spawnShip(ship: ShipSummary, mood: ShipMood) {
    const pos = shipPositionFor(ship.id)

    // Halo behind the ship, animated in tick().
    const halo = new Graphics()
    halo.circle(0, 0, 40).fill({ color: 0x22d3ee, alpha: 1 })
    halo.filters = [new BlurFilter({ strength: 14 })]
    halo.position.set(pos.x, pos.y)
    halo.alpha = 0 // shown only when mood demands it
    halo.eventMode = 'none'
    this.world.addChild(halo)

    const sprite = drawShipSprite({ shipId: ship.id, name: ship.name })
    sprite.position.set(pos.x, pos.y)

    sprite.on('pointerdown', (e) => {
      e.stopPropagation()
      this.events.onShipClick?.(ship.id)
    })
    sprite.on('pointerover', (e: FederatedPointerEvent) => {
      this.events.onShipHover?.(ship.id, e.globalX, e.globalY)
    })
    sprite.on('pointerout', () => {
      this.events.onShipHoverEnd?.()
    })

    this.world.addChild(sprite)
    const entry: ShipEntry = { container: sprite, halo, ship, mood }
    this.ships.set(ship.id, entry)
    this.updateMood(entry, mood)
  }

  private updateMood(entry: ShipEntry, mood: ShipMood): void {
    if (entry.mood === mood) return
    entry.mood = mood
    // Recolor halo.
    entry.halo.clear()
    const color = mood === 'attention' ? 0xfbbf24 /* amber-400 */ : 0x22d3ee /* cyan-400 */
    entry.halo.circle(0, 0, 40).fill({ color, alpha: 1 })
  }

  private attachBackgroundInteractions() {
    const stage = this.app.stage
    stage.eventMode = 'static'
    stage.hitArea = this.app.screen
    stage.on('pointerdown', (e: FederatedPointerEvent) => {
      this.dragging = true
      this.dragStart = { x: e.globalX, y: e.globalY }
      this.worldStart = { x: this.world.position.x, y: this.world.position.y }
    })
    stage.on('pointermove', (e: FederatedPointerEvent) => {
      if (!this.dragging) return
      this.world.position.set(
        this.worldStart.x + (e.globalX - this.dragStart.x),
        this.worldStart.y + (e.globalY - this.dragStart.y),
      )
    })
    const endDrag = (e: FederatedPointerEvent) => {
      const moved =
        Math.abs(e.globalX - this.dragStart.x) > 4 || Math.abs(e.globalY - this.dragStart.y) > 4
      this.dragging = false
      // If we didn't actually drag, count it as a background click.
      if (!moved) this.events.onBackgroundClick?.()
    }
    stage.on('pointerup', endDrag)
    stage.on('pointerupoutside', endDrag)

    // Wheel zoom — bind to the canvas DOM element.
    this.app.canvas.addEventListener('wheel', this.onWheel, { passive: false })
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault()
    const dz = -e.deltaY * ZOOM_SPEED
    const oldScale = this.world.scale.x
    const newScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, oldScale + dz * oldScale))
    if (newScale === oldScale) return
    // Zoom around mouse position.
    const rect = this.app.canvas.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    // World coords under mouse before zoom.
    const wx = (mx - this.world.position.x) / oldScale
    const wy = (my - this.world.position.y) / oldScale
    this.world.scale.set(newScale)
    // Adjust position so the same world point stays under the cursor.
    this.world.position.set(mx - wx * newScale, my - wy * newScale)
  }

  private tick(t: Ticker) {
    // Idle bobbing + halo pulse.
    this.bobTime += t.deltaMS * 0.001
    for (const [, entry] of this.ships) {
      const base = shipPositionFor(entry.ship.id)
      const y = base.y + Math.sin(this.bobTime + base.x * 0.01) * 2
      entry.container.position.y = y
      entry.halo.position.set(base.x, y)

      // Halo pulse: 0 alpha if idle; otherwise sinusoidal alpha + scale.
      if (entry.mood === 'idle') {
        entry.halo.alpha = 0
      } else {
        const period = entry.mood === 'attention' ? 0.6 : 1.8 // seconds
        const ph = (Math.sin((this.bobTime / period) * Math.PI * 2) + 1) / 2 // 0..1
        const maxAlpha = entry.mood === 'attention' ? 0.65 : 0.35
        const minAlpha = entry.mood === 'attention' ? 0.25 : 0.1
        entry.halo.alpha = minAlpha + (maxAlpha - minAlpha) * ph
        entry.halo.scale.set(0.85 + ph * 0.35)
      }
    }
  }
}
