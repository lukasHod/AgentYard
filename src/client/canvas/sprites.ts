import { Container, Graphics, Text, BlurFilter } from 'pixi.js'

/** Deterministic hash → 32-bit unsigned int. djb2 variant. */
function hash32(s: string): number {
  let h = 5381 >>> 0
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return h
}

/** Deterministic position within [-half, half] for a given ship id. */
export function shipPositionFor(id: string | number, halfX = 900, halfY = 600): { x: number; y: number } {
  const h = hash32(String(id))
  const x = ((h % 1009) / 1009) * 2 - 1
  const y = ((Math.floor(h / 1009) % 977) / 977) * 2 - 1
  return { x: x * halfX, y: y * halfY }
}

/** Hash → HSL hue 0..360. */
function hueFor(id: string | number): number {
  const h = hash32(String(id))
  return h % 360
}

function hsl(h: number, s: number, l: number, a = 1): number {
  // Convert HSL [0..360, 0..1, 0..1] → 0xRRGGBB number.
  s = Math.max(0, Math.min(1, s))
  l = Math.max(0, Math.min(1, l))
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hh = ((h % 360) + 360) % 360
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1))
  let r = 0, g = 0, b = 0
  if (hh < 60) [r, g, b] = [c, x, 0]
  else if (hh < 120) [r, g, b] = [x, c, 0]
  else if (hh < 180) [r, g, b] = [0, c, x]
  else if (hh < 240) [r, g, b] = [0, x, c]
  else if (hh < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const m = l - c / 2
  const R = Math.round((r + m) * 255)
  const G = Math.round((g + m) * 255)
  const B = Math.round((b + m) * 255)
  void a // alpha handled by callers
  return (R << 16) | (G << 8) | B
}

export interface DrawShipOptions {
  shipId: string | number
  name: string
  glow?: boolean
  pulse?: boolean
}

export function drawShipSprite(opts: DrawShipOptions): Container {
  const c = new Container()
  c.eventMode = 'static'
  c.cursor = 'pointer'

  const hue = hueFor(opts.shipId)
  const main = hsl(hue, 0.6, 0.55)
  const accent = hsl((hue + 30) % 360, 0.9, 0.7)
  const dark = hsl(hue, 0.3, 0.25)

  // Glow (under the hull) — bigger, softer; rendered as a filtered circle.
  if (opts.glow) {
    const glow = new Graphics()
    glow.circle(0, 0, 40).fill({ color: accent, alpha: 0.25 })
    glow.filters = [new BlurFilter({ strength: 12 })]
    c.addChild(glow)
  }

  // Engine trail (back).
  const trail = new Graphics()
  trail.poly([
    -16, 6,
    -16, -6,
    -28, -3,
    -28, 3,
  ]).fill({ color: accent, alpha: 0.7 })
  c.addChild(trail)

  // Hull — a stylized triangle pointing right.
  const hull = new Graphics()
  hull.poly([
    -16, -10,
    -16, 10,
    -2, 12,
    18, 0,
    -2, -12,
  ]).fill(main)
   .stroke({ color: dark, width: 1.5 })
  c.addChild(hull)

  // Cockpit highlight.
  const cock = new Graphics()
  cock.circle(2, 0, 4).fill({ color: accent, alpha: 0.9 })
  c.addChild(cock)

  // Name label below the ship.
  const text = new Text({
    text: opts.name,
    style: {
      fontFamily: 'Consolas, monospace',
      fontSize: 11,
      fill: 0xa5f3fc, // cyan-200
      letterSpacing: 1.5,
    },
  })
  text.anchor.set(0.5, 0)
  text.position.set(0, 22)
  c.addChild(text)

  return c
}

/** Small glowing circle. role used to hue the drone. */
export function drawDroneSprite(role: string): Container {
  const c = new Container()
  const hue = hueFor(role)
  const ring = new Graphics()
  ring.circle(0, 0, 6).fill({ color: hsl(hue, 0.8, 0.65) })
  ring.circle(0, 0, 10).stroke({ color: hsl(hue, 0.8, 0.65), width: 1, alpha: 0.5 })
  c.addChild(ring)
  return c
}

export function drawStarfield(width: number, height: number, density = 0.0008): Container {
  const c = new Container()
  const count = Math.max(50, Math.floor(width * height * density))
  const g = new Graphics()
  for (let i = 0; i < count; i++) {
    const x = Math.random() * width - width / 2
    const y = Math.random() * height - height / 2
    const a = 0.2 + Math.random() * 0.5
    const size = Math.random() < 0.9 ? 1 : 2
    g.circle(x, y, size).fill({ color: 0xffffff, alpha: a })
  }
  c.addChild(g)
  return c
}

/** Scaffolding frame around a ship in dock view. */
export function drawScaffolding(): Container {
  const c = new Container()
  const g = new Graphics()
  const color = 0x52525b // zinc-600
  // Vertical beams
  for (const x of [-140, 140]) {
    g.rect(x - 3, -180, 6, 360).fill({ color, alpha: 0.7 })
  }
  // Horizontal beams
  for (const y of [-140, 0, 140]) {
    g.rect(-140, y - 2, 280, 4).fill({ color, alpha: 0.5 })
  }
  // Lights at corners
  const corners: Array<[number, number]> = [
    [-140, -180],
    [140, -180],
    [-140, 180],
    [140, 180],
  ]
  for (const [x, y] of corners) {
    g.circle(x, y, 3).fill({ color: 0xfacc15, alpha: 0.9 }) // amber-400
  }
  c.addChild(g)
  return c
}
