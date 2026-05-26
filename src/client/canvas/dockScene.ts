import { Application, Container, Ticker } from 'pixi.js'
import type { PlanetSummary } from '../../core/types'
import { drawDroneSprite, drawScaffolding, drawPlanetSprite, drawStarfield } from './sprites'

export interface DockEvents {
  onBack?: () => void
  onPlanetHullClick?: () => void
  onDroneClick?: (droneRole: string, agentRunId: string) => void
}

interface DroneEntry {
  container: Container
  role: string
  agentRunId: string
  /** Angle around the planet in radians; the ticker advances it. */
  angle: number
  /** Orbit radius (px). */
  radius: number
  /** Vertical orbit speed. */
  speed: number
}

export interface DockDroneSpec {
  role: string
  agentRunId: string
}

const BASE_RADIUS = 170

export class DockScene {
  readonly root: Container
  private app: Application
  private events: DockEvents
  private centerLayer: Container
  private starfield: Container
  private drones = new Map<string, DroneEntry>()
  private planetSprite: Container | null = null
  private tickerFn: (t: Ticker) => void
  private time = 0
  /** Pixels reserved at the right edge for the always-visible cockpit panel. */
  private panelWidth = 0

  constructor(app: Application, events: DockEvents = {}) {
    this.app = app
    this.events = events
    this.root = new Container()
    this.starfield = drawStarfield(this.app.screen.width * 2, this.app.screen.height * 2, 0.0004)
    this.root.addChild(this.starfield)
    this.centerLayer = new Container()
    this.root.addChild(this.centerLayer)
    this.repositionCenter()

    // Scaffolding behind the planet.
    const scaffolding = drawScaffolding()
    this.centerLayer.addChild(scaffolding)

    this.tickerFn = (t: Ticker) => this.tick(t)
    this.app.ticker.add(this.tickerFn)
  }

  /** Tell the scene how many pixels the right-side panel occupies. */
  setPanelWidth(px: number): void {
    this.panelWidth = px
    this.repositionCenter()
  }

  private repositionCenter(): void {
    const cx = (this.app.screen.width - this.panelWidth) / 2
    const cy = this.app.screen.height / 2
    this.centerLayer.position.set(cx, cy)
    this.starfield.position.set(cx, cy)
  }

  destroy() {
    this.app.ticker.remove(this.tickerFn)
    this.root.destroy({ children: true })
  }

  setPlanet(planet: PlanetSummary | null) {
    if (this.planetSprite) {
      this.centerLayer.removeChild(this.planetSprite)
      this.planetSprite.destroy({ children: true })
      this.planetSprite = null
    }
    if (!planet) return
    const sprite = drawPlanetSprite({ planetId: planet.id, name: planet.name, glow: true })
    sprite.scale.set(4) // bigger in dock view
    sprite.on('pointerdown', () => this.events.onPlanetHullClick?.())
    this.centerLayer.addChild(sprite)
    this.planetSprite = sprite
  }

  setDrones(specs: DockDroneSpec[]) {
    const incoming = new Map(specs.map((d) => [d.agentRunId, d]))
    // Remove gone drones.
    for (const [id, entry] of this.drones) {
      if (!incoming.has(id)) {
        this.centerLayer.removeChild(entry.container)
        entry.container.destroy({ children: true })
        this.drones.delete(id)
      }
    }
    // Add new drones.
    const count = specs.length
    let i = 0
    for (const spec of specs) {
      if (this.drones.has(spec.agentRunId)) {
        i++
        continue
      }
      const c = drawDroneSprite(spec.role)
      c.eventMode = 'static'
      c.cursor = 'pointer'
      c.on('pointerdown', (e) => {
        e.stopPropagation()
        this.events.onDroneClick?.(spec.role, spec.agentRunId)
      })
      this.centerLayer.addChild(c)
      const startAngle = (2 * Math.PI * i) / Math.max(1, count) + Math.random() * 0.3
      this.drones.set(spec.agentRunId, {
        container: c,
        role: spec.role,
        agentRunId: spec.agentRunId,
        angle: startAngle,
        radius: BASE_RADIUS + (i % 2 === 0 ? 0 : 30),
        speed: 0.5 + Math.random() * 0.4,
      })
      i++
    }
  }

  private tick(t: Ticker) {
    this.time += t.deltaMS * 0.001
    // Keep center responsive to window resize.
    this.repositionCenter()
    for (const [, entry] of this.drones) {
      entry.angle += entry.speed * t.deltaMS * 0.0008
      const x = Math.cos(entry.angle) * entry.radius
      const y = Math.sin(entry.angle) * entry.radius * 0.6 // slightly flat orbit
      entry.container.position.set(x, y)
    }
  }
}
